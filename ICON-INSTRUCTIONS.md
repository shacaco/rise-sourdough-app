# Icon Generation Instructions

## How to Generate Icons

### Method 1: Using the Icon Generator (Recommended)

1. Open `icons/generate-icons.html` in your web browser
2. The page will automatically generate and download all required icon files
3. Save the downloaded files to the `icons/` directory

### Method 2: Using the Favicon Generator

1. Open `favicon-generator.html` in your web browser
2. Click "Generate favicon.ico" to download the favicon
3. Save the downloaded `favicon.ico` to the root directory

### Required Icon Files

After running the generators, you should have these files:

**Root Directory:**
- `favicon.ico` (16x16, 32x32 combined)

**Icons Directory (`/icons/`):**
- `favicon-16x16.png`
- `favicon-32x32.png`
- `apple-touch-icon.png` (180x180)
- `icon-192x192.png`
- `icon-512x512.png`
- `mstile-150x150.png`
- `safari-pinned-tab.svg`

### Icon Design

The icons feature:
- **Background**: Light beige (#f3e9dc) circle
- **Bread Loaf**: Medium brown (#d4af8c) rounded rectangle
- **Texture**: Dark brown (#4a2c0a) curved lines
- **Letter**: Bold "R" in dark brown (#4a2c0a)

### Alternative: Online Icon Generators

If you prefer, you can also use online tools:
1. Upload `icons/icon.svg` to favicon.io or realfavicongenerator.net
2. Download the generated files
3. Place them in the appropriate directories

### Testing

After generating the icons:
1. Open `index.html` in a browser
2. Check that the favicon appears in the browser tab
3. Test PWA installation to verify app icons work correctly
