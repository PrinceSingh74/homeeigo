Save the HOMIGO hero villa image in THIS folder as:

    hero-villa.jpg

The mobile HeroSection imports it via:
    require("../../assets/hero-villa.jpg")

IMPORTANT: React Native bundles this image at build time. Until
hero-villa.jpg exists here, Metro will fail to bundle the app.
After adding the file, reload the Expo app (press "r" in the
Expo terminal) to pick it up.
