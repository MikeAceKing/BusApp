# BusApp security

Please report a suspected vulnerability privately to the repository owner. Do not open a public issue containing credentials, parent codes, passenger information, private photo URLs or production data.

## Profile and photo model

- A BusApp user may update only their own canonical profile.
- A parent may update only a passenger explicitly linked through a current, non-revoked parent grant.
- Owners and attendants may update passenger avatars in their Bus Space; drivers may not.
- Only a Bus Space owner may update the bus profile or bus photo.
- Uploaded media is accepted only by the isolated `bus-app-media` Edge Function after authentication and target authorization.
- JPEG, PNG and WebP are checked by declared MIME type and file signature. SVG, HTML, GIF, PDF, animation and mismatched files are rejected. The input limit is 5 MiB.
- Images are auto-oriented, cropped, resized, stripped of metadata (including EXIF/GPS) and re-encoded as WebP before private storage.
- The `bus-app-private-media` bucket is private. The browser receives short-lived signed thumbnail URLs, never storage authority.
- Passenger identity has one canonical avatar reference. Parent, staff and active-trip views resolve that same reference and receive user-targeted refresh pulses.

Never commit Supabase service-role keys, database passwords, code-hash secrets, web-push private keys, parent codes, user photos or signed media URLs.
