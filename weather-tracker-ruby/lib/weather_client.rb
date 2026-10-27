# frozen_string_literal: true

require 'net/http'
require 'json'
require 'uri'

class WeatherClient
  class Error < StandardError; end

  FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
  GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
  LOCATION_URL = 'https://geocoding-api.open-meteo.com/v1/get'

  CURRENT_FIELDS = %w[
    temperature_2m apparent_temperature relative_humidity_2m weather_code
    is_day wind_speed_10m precipitation
  ].freeze
  HOURLY_FIELDS = %w[temperature_2m precipitation_probability weather_code].freeze
  DAILY_FIELDS = %w[
    weather_code temperature_2m_max temperature_2m_min
    precipitation_probability_max uv_index_max sunrise sunset
  ].freeze

  def initialize(http_get: nil)
    @http_get = http_get || method(:http_json)
  end

  def search(city)
    term = city.to_s.strip
    return [] if term.length < 2 || term.length > 100

    result = @http_get.call(GEOCODE_URL, { name: term, count: 7, language: 'en', format: 'json' })
    Array(result['results']).filter_map do |place|
      next unless place['id'] && place['latitude'] && place['longitude']

      location_from_api(place)
    end
  end

  def location(geocoding_id)
    result = @http_get.call(LOCATION_URL, { id: geocoding_id })
    raise Error, 'This location could not be found.' unless result.is_a?(Hash) && result['id']

    location_from_api(result)
  end

  def forecast(latitude, longitude)
    raw = @http_get.call(FORECAST_URL, {
      latitude: latitude,
      longitude: longitude,
      current: CURRENT_FIELDS.join(','),
      hourly: HOURLY_FIELDS.join(','),
      daily: DAILY_FIELDS.join(','),
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      precipitation_unit: 'mm',
      timezone: 'auto',
      forecast_days: 7
    })
    self.class.normalize(raw)
  end

  def self.normalize(raw)
    current = raw.fetch('current')
    hourly = raw.fetch('hourly')
    daily = raw.fetch('daily')
    raise Error, 'Incomplete weather data received.' unless current['temperature_2m'] && current['time']

    # Open-Meteo returns local timestamps when timezone=auto. Compare ISO-formatted
    # local-hour strings, not browser-local Date objects, to preserve city time.
    current_hour = current['time'][0, 13]
    hours = Array(hourly['time']).each_index.filter_map do |i|
      next if hourly['time'][i].to_s[0, 13] < current_hour

      {
        time: hourly['time'][i],
        temperature: hourly['temperature_2m']&.[](i),
        rain_chance: hourly['precipitation_probability']&.[](i),
        code: hourly['weather_code']&.[](i)
      }
    end.first(24)

    days = Array(daily['time']).each_index.map do |i|
      {
        date: daily['time'][i],
        high: daily['temperature_2m_max']&.[](i),
        low: daily['temperature_2m_min']&.[](i),
        rain_chance: daily['precipitation_probability_max']&.[](i),
        code: daily['weather_code']&.[](i),
        uv_max: daily['uv_index_max']&.[](i),
        sunrise: daily['sunrise']&.[](i),
        sunset: daily['sunset']&.[](i)
      }
    end

    {
      timezone: raw['timezone'],
      timezone_abbreviation: raw['timezone_abbreviation'],
      current: {
        time: current['time'],
        temperature: current['temperature_2m'],
        feels_like: current['apparent_temperature'],
        humidity: current['relative_humidity_2m'],
        code: current['weather_code'],
        is_day: current['is_day'],
        wind: current['wind_speed_10m'],
        precipitation: current['precipitation']
      },
      hourly: hours,
      daily: days,
      units: { temperature: '°C', wind: 'km/h', precipitation: 'mm' }
    }
  rescue KeyError, TypeError, NoMethodError => e
    raise Error, "Incomplete weather data received (#{e.class})."
  end

  private

  def location_from_api(place)
    {
      geocoding_id: place['id'],
      name: place['name'].to_s,
      admin1: place['admin1'].to_s,
      country: place['country'].to_s,
      country_code: place['country_code'].to_s,
      latitude: place['latitude'].to_f,
      longitude: place['longitude'].to_f,
      timezone: place['timezone'].to_s
    }
  end

  def http_json(base_url, params)
    uri = URI(base_url)
    uri.query = URI.encode_www_form(params)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = 5
    http.read_timeout = 12
    response = http.get(uri.request_uri, { 'User-Agent' => 'SkylineWeatherTracker/1.0' })
    result = JSON.parse(response.body)

    unless response.is_a?(Net::HTTPSuccess) && !result['error']
      raise Error, result['reason'].to_s.empty? ? 'The weather service is temporarily unavailable.' : result['reason']
    end

    result
  rescue Net::OpenTimeout, Net::ReadTimeout, SocketError, EOFError, Errno::ECONNRESET
    raise Error, 'Unable to reach the weather service. Check your internet connection.'
  rescue JSON::ParserError
    raise Error, 'The weather service sent an unexpected response.'
  end
end
