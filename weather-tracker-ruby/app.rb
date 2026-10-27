# frozen_string_literal: true

require 'sinatra/base'
require 'json'
require 'csv'
require 'time'
require_relative 'lib/weather_client'
require_relative 'lib/store'

class WeatherTracker < Sinatra::Base
  configure do
    set :root, File.expand_path(__dir__)
    set :views, File.join(root, 'views')
    set :public_folder, File.join(root, 'public')
    set :bind, ENV.fetch('BIND', '127.0.0.1')
    set :port, Integer(ENV.fetch('PORT', '4567'))
    set :server, :puma
    set :show_exceptions, false
    set :store, Store.new
    set :weather_client, WeatherClient.new
  end

  before '/api/*' do
    content_type :json
    headers 'Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff'
  end

  helpers do
    def json_response(object, status_code = 200)
      status status_code
      JSON.generate(object)
    end

    def json_body
      raise ArgumentError, 'Please send JSON.' unless request.media_type == 'application/json'
      body = request.body.read(4_097)
      raise ArgumentError, 'Request body is too large.' if body.bytesize > 4_096

      parsed = JSON.parse(body)
      raise ArgumentError, 'Expected a JSON object.' unless parsed.is_a?(Hash)

      parsed
    rescue JSON::ParserError
      raise ArgumentError, 'Malformed JSON request.'
    end

    def place_id!
      id = Integer(params.fetch('id'))
      halt 400, json_response({ error: 'Invalid location ID.' }, 400) unless id.positive?

      id
    rescue ArgumentError, TypeError
      halt 400, json_response({ error: 'Invalid location ID.' }, 400)
    end

    def existing_place!
      place = settings.store.place(place_id!)
      halt 404, json_response({ error: 'Location not found.' }, 404) unless place

      place
    end
  end

  get '/' do
    content_type :html
    erb :index
  end

  get '/health' do
    content_type :json
    json_response({ ok: true })
  end

  get '/api/search' do
    query = params.fetch('q', '').to_s.strip
    halt 400, json_response({ error: 'Enter at least 2 characters to search.' }, 400) if query.length < 2 || query.length > 100

    json_response({ results: settings.weather_client.search(query) })
  end

  get '/api/places' do
    json_response({ places: settings.store.places })
  end

  post '/api/places' do
    id = Integer(json_body.fetch('geocoding_id'))
    halt 400, json_response({ error: 'Invalid location.' }, 400) unless id.positive?

    # Look up the ID again server-side; do not trust client-submitted coordinates.
    info = settings.weather_client.location(id)
    place = settings.store.add_place(info)
    json_response({ place: place }, 201)
  rescue KeyError, ArgumentError, TypeError
    json_response({ error: 'Select a location from search results.' }, 400)
  end

  delete '/api/places/:id' do
    existing_place!
    settings.store.delete_place(place_id!)
    status 204
    body ''
  end

  get '/api/places/:id/weather' do
    place = existing_place!
    weather = settings.weather_client.forecast(place[:latitude], place[:longitude])
    settings.store.add_snapshot(place[:id], weather)
    json_response({ place: place, weather: weather, fetched_at: Time.now.utc.iso8601 })
  end

  get '/api/places/:id/history' do
    place = existing_place!
    days = params['days'].to_i == 30 ? 30 : 14
    json_response({ place_id: place[:id], days: days, snapshots: settings.store.history(place[:id], days: days) })
  end

  get '/api/places/:id/history.csv' do
    place = existing_place!
    days = params['days'].to_i == 30 ? 30 : 14
    records = settings.store.history(place[:id], days: days)
    content_type 'text/csv', charset: 'utf-8'
    attachment "#{place[:name].downcase.gsub(/[^a-z0-9]+/, '-')}-weather-history.csv"
    CSV.generate do |csv|
      csv << %w[recorded_at_utc temperature_c feels_like_c humidity_percent wind_kmh weather_code precipitation_mm]
      records.each do |entry|
        csv << [:recorded_at, :temperature, :feels_like, :humidity, :wind, :code, :precipitation].map { |key| entry[key] }
      end
    end
  end

  error WeatherClient::Error do
    json_response({ error: env['sinatra.error'].message }, 502)
  end

  error SQLite3::Exception do
    warn "Database error: #{env['sinatra.error'].message}"
    json_response({ error: 'Unable to access saved weather data.' }, 500)
  end

  error do
    warn "Unexpected error: #{env['sinatra.error'].class}: #{env['sinatra.error'].message}"
    json_response({ error: 'Something went wrong. Please try again.' }, 500)
  end
end

WeatherTracker.run! if $PROGRAM_NAME == __FILE__
