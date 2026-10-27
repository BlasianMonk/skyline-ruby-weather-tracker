# frozen_string_literal: true

require 'minitest/autorun'
require_relative '../lib/weather_client'

class WeatherClientTest < Minitest::Test
  def setup
    @client = WeatherClient.new(http_get: lambda { |url, _params|
      if url.include?('/search')
        { 'results' => [{ 'id' => 123, 'name' => 'Test City', 'latitude' => 20.5,
                          'longitude' => -10.0, 'admin1' => 'Region', 'country' => 'Sampleland' }] }
      elsif url.include?('/get')
        { 'id' => 123, 'name' => 'Test City', 'latitude' => 20.5, 'longitude' => -10.0 }
      else
        sample_forecast
      end
    })
  end

  def test_geocoding_results_are_normalized
    places = @client.search('Test')
    assert_equal 1, places.size
    assert_equal 123, places.first[:geocoding_id]
    assert_equal 'Region', places.first[:admin1]
  end

  def test_short_queries_return_no_results
    assert_empty @client.search('A')
  end

  def test_location_uses_provider_record
    assert_equal 20.5, @client.location(123)[:latitude]
  end

  def test_normalizes_forecast_to_hourly_daily_and_current
    result = @client.forecast(20.5, -10.0)
    assert_equal 21.5, result[:current][:temperature]
    assert_equal 3, result[:hourly].size
    assert_equal '2026-10-27T10:00', result[:hourly].first[:time]
    assert_equal 64, result[:hourly].last[:rain_chance]
    assert_equal 25.0, result[:daily].first[:high]
    assert_equal '°C', result[:units][:temperature]
  end

  def test_missing_current_data_reports_error
    assert_raises(WeatherClient::Error) { WeatherClient.normalize('current' => {}, 'hourly' => {}, 'daily' => {}) }
  end

  private

  def sample_forecast
    {
      'timezone' => 'Europe/London',
      'current' => { 'time' => '2026-10-27T10:20', 'temperature_2m' => 21.5,
                     'apparent_temperature' => 22.0, 'relative_humidity_2m' => 60,
                     'weather_code' => 2, 'is_day' => 1, 'wind_speed_10m' => 13,
                     'precipitation' => 0.0 },
      'hourly' => { 'time' => %w[2026-10-27T09:00 2026-10-27T10:00 2026-10-27T11:00 2026-10-27T12:00],
                    'temperature_2m' => [20, 21, 22, 23],
                    'precipitation_probability' => [0, 10, 20, 64],
                    'weather_code' => [0, 2, 2, 61] },
      'daily' => { 'time' => ['2026-10-27'], 'temperature_2m_max' => [25.0],
                   'temperature_2m_min' => [15.0], 'weather_code' => [2],
                   'precipitation_probability_max' => [40], 'uv_index_max' => [4],
                   'sunrise' => ['2026-10-27T07:10'], 'sunset' => ['2026-10-27T17:45'] }
    }
  end
end
