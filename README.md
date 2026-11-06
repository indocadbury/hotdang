# HotDang!

**Find the closest hotdog to you, anywhere in the world.**

HotDang is an open-source app that maps every place you can get a hotdog: street vendors and food trucks, restaurants, and the hotdog on the shelf or roller grill at your local 7-Eleven, servo or Costco.

> Status: early clickable prototype. The spots, reviews and leaderboard in it are example data.

## Features (prototype)

- **Dog me!** One tap finds your nearest hotdog and shows the walk time.
- **Map** with mini-hotdog pins for street vendors, restaurants and shelf spots, plus filters.
- **Live street vendors**: carts and trucks show where they are right now.
- **Directions** that open in Google Maps.
- **Hotdog counter**: tap "I ate one!" to log every dog you eat.
- **Leaderboard** for the most hotdogs eaten.
- **Ratings and reviews** for every spot.
- **Add a spot** with a price and photo, and keep spots fresh with "Still here" checks.

## Try it

Open `index.html` in any browser. There's no build step.

## Where the data will come from

| Source | Used for |
| --- | --- |
| Google Places / Google Maps | Restaurants and directions |
| OpenStreetMap (`cuisine=hot_dog`) | A free base layer of stands and restaurants |
| Chain store lists (7-Eleven, servos, Costco, IKEA) | Shelf and roller-grill spots |
| The community | New spots, photos, prices, "still here" checks, reviews |
| Vendors | Live location sharing for carts and food trucks |

## Roadmap

- [ ] Real map tiles and real GPS location
- [ ] Backend for accounts, spots, reviews and leaderboards
- [ ] Import from OpenStreetMap and chain store lists
- [ ] Vendor mode for sharing live location
- [ ] iOS and Android apps

## Contributing

Ideas and code are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Every change is reviewed and approved by the project owner before it's merged.

## License

[MIT](LICENSE)
