# HotDang!

**Find the closest hotdog to you, anywhere in the world.**

HotDang is an open-source app that maps every place you can get a hotdog: street vendors and food trucks, restaurants, and the hotdog on the shelf or roller grill at your local 7-Eleven, servo or Costco.

> Status: **v0.1**. Real map, real GPS and real hotdog spots worldwide from OpenStreetMap. Your counter, reviews and added spots are saved on your device until accounts arrive.
>
> Live app: https://indocadbury.github.io/hotdang/ · Original design prototype: [`prototype/`](prototype/index.html)

## Features

- **Dog me!** One tap finds your nearest hotdog and shows the walk time.
- **Real map** with mini-hotdog pins for street vendors, restaurants and shelf spots, plus filters.
- **Your location** as a very full cartoon pup (GPS, or tap "Move me").
- **Directions** that open in Google Maps.
- **Hotdog counter**: tap "I ate one!" to log every dog you eat.
- **My hotdogs**: your count, this week, and recent dogs. A global leaderboard comes with accounts.
- **Ratings and reviews** for every spot.
- **Add a spot** with a price and photo, and keep spots fresh with "Still here" checks.

## Try it

Visit the live app, or serve the folder locally (location needs https or localhost):

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

There's no build step. The code is `index.html`, `style.css` and `app.js`.

## Where the data will come from

| Source | Used for |
| --- | --- |
| Google Places / Google Maps | Restaurants and directions |
| OpenStreetMap (`cuisine=hot_dog`) | A free base layer of stands and restaurants |
| Chain store lists (7-Eleven, servos, Costco, IKEA) | Shelf and roller-grill spots |
| The community | New spots, photos, prices, "still here" checks, reviews |
| Vendors | Live location sharing for carts and food trucks |

## Roadmap

- [x] Real map tiles and real GPS location
- [x] Hotdog spots from OpenStreetMap and chain store lists
- [ ] Backend for accounts, shared spots, reviews and the global leaderboard
- [ ] Google Places for better restaurant coverage
- [ ] Vendor mode for sharing live location
- [ ] iOS and Android apps

## Contributing

Ideas and code are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Every change is reviewed and approved by the project owner before it's merged.

## License

[MIT](LICENSE)
