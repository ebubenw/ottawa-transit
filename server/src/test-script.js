import "dotenv/config";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const url = process.env.VEHICLE_POSITIONS_URL;
const key = process.env.OC_TRANSPO_API_KEY;

if (!url || !key) {
  console.error("Missing VEHICLE_POSITIONS_URL or OC_TRANSPO_API_KEY in .env");
  process.exit(1);
}

// 1. Fetch the feed, sending the api key in the header
const res = await fetch(url, {
  headers: { "Ocp-Apim-Subscription-Key": key },
});

if (!res.ok) {
  console.error(`Request failed: ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}

// 2. decode the binary protocol buffers data
const buffer = await res.arrayBuffer();
const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
  new Uint8Array(buffer),
);

// 3.log a summary and the first few buses
const vehicles = feed.entity.filter((e) => e.vehicle);
const feedTime = new Date(Number(feed.header.timestamp.toString()) * 1000);

console.log(`Feed updated: ${feedTime.toLocaleString()}`);
console.log(`Buses in feed: ${vehicles.length}\n`);

vehicles.slice(0, 5).forEach(({ vehicle }) => {
  console.log({
    busId: vehicle.vehicle?.id,
    route: vehicle.trip?.routeId,
    tripId: vehicle.trip?.tripId,
    lat: vehicle.position?.latitude,
    lng: vehicle.position?.longitude,
  });
});
