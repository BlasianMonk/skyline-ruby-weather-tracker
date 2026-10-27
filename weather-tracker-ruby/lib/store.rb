# frozen_string_literal: true

require 'sqlite3'
require 'fileutils'
require 'time'

class Store
  def initialize(path: File.expand_path('../data/weather.sqlite3', __dir__))
    @path = path
    FileUtils.mkdir_p(File.dirname(@path))
    setup!
  end

  def places
    with_db do |db|
      db.execute(<<~SQL).map { |row| place_hash(row) }
        SELECT p.*,
               (SELECT s.temperature FROM snapshots s
                WHERE s.place_id = p.id ORDER BY s.recorded_at DESC LIMIT 1) AS last_temperature
        FROM places p ORDER BY p.added_at DESC, p.id DESC
      SQL
    end
  end

  def place(id)
    with_db do |db|
      row = db.get_first_row('SELECT * FROM places WHERE id = ?', [id])
      row && place_hash(row)
    end
  end

  def add_place(data)
    with_db do |db|
      db.execute(<<~SQL, [data[:geocoding_id], data[:name], data[:admin1], data[:country], data[:country_code], data[:latitude], data[:longitude], data[:timezone]])
        INSERT OR IGNORE INTO places
          (geocoding_id, name, admin1, country, country_code, latitude, longitude, timezone)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      SQL
      row = db.get_first_row('SELECT * FROM places WHERE geocoding_id = ?', [data[:geocoding_id]])
      place_hash(row)
    end
  end

  def delete_place(id)
    with_db do |db|
      db.execute('DELETE FROM places WHERE id = ?', [id])
      db.changes > 0
    end
  end

  def add_snapshot(place_id, conditions)
    now = Time.now.utc
    current = conditions.fetch(:current)
    with_db do |db|
      db.execute(<<~SQL, [place_id, now.iso8601, now.strftime('%Y-%m-%dT%H'), current[:temperature], current[:feels_like], current[:humidity], current[:wind], current[:code], current[:precipitation]])
        INSERT OR IGNORE INTO snapshots
          (place_id, recorded_at, hour_bucket, temperature, feels_like,
           humidity, wind, weather_code, precipitation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      SQL
    end
  end

  def history(place_id, days: 14)
    cutoff = (Time.now.utc - days * 86_400).iso8601
    with_db do |db|
      db.execute(<<~SQL, [place_id, cutoff]).map do |row|
        SELECT recorded_at, temperature, feels_like, humidity, wind, weather_code, precipitation
        FROM snapshots WHERE place_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC
      SQL
        {
          recorded_at: row['recorded_at'], temperature: row['temperature'],
          feels_like: row['feels_like'], humidity: row['humidity'],
          wind: row['wind'], code: row['weather_code'],
          precipitation: row['precipitation']
        }
      end
    end
  end

  private

  def setup!
    with_db do |db|
      db.execute_batch(<<~SQL)
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS places (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          geocoding_id INTEGER NOT NULL UNIQUE,
          name TEXT NOT NULL,
          admin1 TEXT,
          country TEXT,
          country_code TEXT,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          timezone TEXT,
          added_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
          recorded_at TEXT NOT NULL,
          hour_bucket TEXT NOT NULL,
          temperature REAL,
          feels_like REAL,
          humidity REAL,
          wind REAL,
          weather_code INTEGER,
          precipitation REAL,
          UNIQUE(place_id, hour_bucket)
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_place_time
          ON snapshots(place_id, recorded_at);
      SQL
      # Sample city makes a fresh install immediately useful. It's removable.
      unless db.get_first_value("SELECT value FROM settings WHERE key = 'seeded'")
        if db.get_first_value('SELECT COUNT(*) FROM places').to_i.zero?
          db.execute(<<~SQL)
            INSERT OR IGNORE INTO places
              (geocoding_id, name, admin1, country, country_code, latitude, longitude, timezone)
            VALUES (5128581, 'New York', 'New York', 'United States', 'US', 40.71427, -74.00597, 'America/New_York')
          SQL
        end
        db.execute("INSERT INTO settings (key, value) VALUES ('seeded', '1')")
      end
    end
  end

  def with_db
    db = SQLite3::Database.new(@path)
    db.results_as_hash = true
    db.busy_timeout = 3_000
    db.execute('PRAGMA foreign_keys = ON')
    db.execute('PRAGMA journal_mode = WAL')
    yield(db)
  ensure
    db&.close
  end

  def place_hash(row)
    {
      id: row['id'], geocoding_id: row['geocoding_id'], name: row['name'],
      admin1: row['admin1'], country: row['country'], country_code: row['country_code'],
      latitude: row['latitude'], longitude: row['longitude'], timezone: row['timezone'],
      last_temperature: row['last_temperature']
    }
  end
end
