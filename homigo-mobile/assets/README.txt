Save the HOMIGO hero villa image in THIS folder as:

    hero-villa.webp

The mobile HeroSection imports it via:
    require("../../assets/hero-villa.webp")

IMPORTANT: React Native bundles this image at build time. Until
hero-villa.webp exists here, Metro will fail to bundle the app.
After adding the file, reload the Expo app (press "r" in the
Expo terminal) to pick it up.
