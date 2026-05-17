Save the HOMIGO hero villa image in THIS folder as:

    hero-villa.png

The mobile HeroSection imports it via:
    require("../../assets/hero-villa.png")

IMPORTANT: React Native bundles this image at build time. Until
hero-villa.png exists here, Metro will fail to bundle the app.
After adding the file, reload the Expo app (press "r" in the
Expo terminal) to pick it up.
