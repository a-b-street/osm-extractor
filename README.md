# OSM Extractor

This is a small NodeJS server that takes a polygon and returns OpenStreetMap PBF data clipped to
that boundary. It uses [GeoDesk](https://www.geodesk.com) to efficiently extract OSM data, then
[Osmium](https://osmcode.org/osmium-tool) to clip to the precise boundary and convert from the large
XML to the much more compact PBF.

Depending how you maintain and refresh the input GOL file, the data returned will be recent or not.
You could also query the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) to get
much more up-to-date extracts, but this API is slower, is experiencing sporadic availability as of
November 2025, and returns larger XML data.

## Calling it

The input POST body should be a single GeoJSON Feature with a Polygon geometry. The properties must
be set to something -- at least `{}`, but properties can be filled out (and will be logged).

```
curl http://localhost:3000 \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[-1.6181559940271484,53.83772286984376],[-1.6581718271386592,53.75619889723589],[-1.411653714426592,53.748948101502265],[-1.45839960864663,53.842255054099155],[-1.6181559940271484,53.83772286984376]]]},"properties":{}}' > leeds.osm.pbf
```

## Setup

- Install the GOL CLI: https://www.geodesk.com/download
- Install osmium: https://osmcode.org/osmium-tool/
- Install node: https://docs.npmjs.com/downloading-and-installing-node-js-and-npm
- Install this server's dependencies: `npm ci`

You need a GOL v2 file to source the data. You can get a planet-wide one from
https://openplanetdata.com/ or build one from smaller OSM extracts using
https://docs.geodesk.com/gol/build.

Edit the constants at the top of `server.js` as needed, then `npm run server`.

By default, the server logs to `requests.log` in the GEOJSONL format -- one GeoJSON Feature per
line, with some `stats` properties filled out.
