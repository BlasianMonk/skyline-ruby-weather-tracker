# Skyline — Ruby Weather Tracker

A responsive personal weather-tracking web app built with **Ruby**, **Sinatra**, **SQLite**, and vanilla JavaScript. It uses the [Open-Meteo Forecast API](https://open-meteo.com/en/docs) and [Geocoding API](https://open-meteo.com/en/docs/geocoding-api), so **no API key is needed** for standard non-commercial use.

## Features

- Search for cities worldwide and save multiple locations.
- See current weather, feels-like temperature, humidity, wind, precipitation, and UV index.
- Explore a 24-hour temperature chart and seven-day forecast.
- Toggle between Celsius/km/h/mm and Fahrenheit/mph/inches.
- Track hourly weather observations in a local SQLite database.
- Inspect up to 14 or 30 days of your recorded weather and export history as CSV.
- Optional command-line capture job records weather even if the website is not open.
- Mobile-friendly dashboard, with no paid UI libraries or frontend build step.

## Requirements

- Ruby **3.1+** (Ruby 3.3 recommended)
- Bundler (`gem install bundler` if missing)
- Internet connection to query Open-Meteo

## Quick start

In Terminal / PowerShell, open this project folder and run:

```bash
bundle install
bundle exec ruby app.rb
```

Then visit **http://localhost:4567** in your browser.

The app starts with **New York as a removable sample location**. Search for any city, select a result, and it will be saved. You can delete New York if it isn't relevant.

To change the port:

```bash
PORT=3000 bundle exec ruby app.rb
```

On PowerShell:

```powershell
$env:PORT = '3000'
bundle exec ruby app.rb
```

By default, the web server binds to **127.0.0.1** for privacy. Set `BIND=0.0.0.0` only if you understand how to secure access on your network.

## Tracking observations

Viewing a saved city's live weather automatically saves **at most one snapshot per UTC hour**. Each snapshot includes temperature, feels-like temperature, humidity, wind speed, weather code, and precipitation.

The app **does not automatically record weather when the Ruby server is stopped**, and the browser does not need to stay open if you run the optional capture job:

```bash
bundle exec ruby bin/capture
```

For an hourly automated capture on macOS or Linux, open `crontab -e` and add (replace the folder path with your own absolute path):

```cron
5 * * * * cd /absolute/path/to/weather-tracker-ruby && /absolute/path/to/bundle exec ruby bin/capture >> /tmp/skyline-weather.log 2>&1
```

Find Bundler's absolute path using `which bundle`. On Windows, use **Task Scheduler** to run `bundle exec ruby bin/capture` hourly with the project folder as its starting directory. If you use Ruby version managers, configure cron/scheduler to load the correct Ruby environment.

History is **recorded data collected by this app**, not weather observations from before you installed it. It will build up over repeated hourly captures. Reopening the app does not erase saved observations.

## Project layout

```text
weather-tracker-ruby/
├── app.rb                  # Sinatra routes / API
├── config.ru               # Rack entry point
├── Gemfile                 # Ruby dependencies
├── lib/
│   ├── weather_client.rb   # Open-Meteo HTTP client + response normalization
│   └── store.rb            # SQLite locations and history
├── views/
│   └── index.erb           # Dashboard HTML
├── public/
│   ├── app.js              # UI, search, SVG charts, units, saved cities
│   ├── styles.css          # Responsive dark theme
│   └── favicon.svg
├── bin/
│   └── capture             # Optional scheduled weather recording
├── test/
│   └── weather_client_test.rb
└── data/                   # Created locally; SQLite DB is git-ignored
```

## Local API routes

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/search?q=Paris` | Search cities |
| GET | `/api/places` | List saved cities |
| POST | `/api/places` | Save city with JSON `{ "geocoding_id": 2988507 }` |
| DELETE | `/api/places/:id` | Remove a saved city and history |
| GET | `/api/places/:id/weather` | Current + hourly + 7-day forecast; records a snapshot |
| GET | `/api/places/:id/history?days=14` | Logged observations (14 or 30 days) |
| GET | `/api/places/:id/history.csv?days=30` | Download tracked data as CSV |
| GET | `/health` | Basic status check |

All weather data is stored internally in Celsius, km/h, and millimeters. Unit conversion happens in the browser and CSV exports preserve those base units.

## Tests

Run the provider's response normalization tests (no network connection necessary):

```bash
ruby test/weather_client_test.rb
```

## Deployment and privacy notes

This starter app is designed for **local, single-user use**. It has no login system and no CSRF layer, so **do not expose it on the public internet as-is**. Add authentication, request protections, TLS/reverse proxy configuration, and rate limiting before public hosting. Never commit or share the `data/*.sqlite3` files if your tracked location history is private.

Live information comes from Open-Meteo and can be delayed, incomplete, or revised. Do not rely on this app for severe weather warnings or safety-critical decisions. See the [Open-Meteo license and commercial terms](https://open-meteo.com/en/terms).

## Customization

- Update colors, card styling, typography, and mobile layouts in `public/styles.css`.
- Modify the presentation and weather-code SVG icons in `public/app.js`.
- Change page labels and panels in `views/index.erb`.
- Add fields to the Open-Meteo request in `lib/weather_client.rb`.
- Extend the SQLite schema and recording logic in `lib/store.rb`.
