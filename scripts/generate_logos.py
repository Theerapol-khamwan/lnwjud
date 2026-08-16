import os
import shutil
from PIL import Image

SOURCE_PATH = r"C:\Users\developer\.gemini\antigravity\brain\29bd6992-96b0-4d52-983c-905b3cc1997d\.user_uploaded\media_1786886545203.png"
WORKSPACE_ROOT = r"e:\lnwjud"

def generate():
    if not os.path.exists(SOURCE_PATH):
        raise FileNotFoundError(f"Source file not found: {SOURCE_PATH}")

    img = Image.open(SOURCE_PATH).convert("RGBA")
    print(f"Loaded master logo: {img.size} {img.mode}")

    # Output directories
    assets_dir = os.path.join(WORKSPACE_ROOT, "assets", "logo")
    desktop_build_dir = os.path.join(WORKSPACE_ROOT, "apps", "desktop", "build")
    desktop_icons_dir = os.path.join(desktop_build_dir, "icons")
    renderer_public_dir = os.path.join(WORKSPACE_ROOT, "apps", "desktop", "src", "renderer", "public")

    for d in [assets_dir, desktop_build_dir, desktop_icons_dir, renderer_public_dir]:
        os.makedirs(d, exist_ok=True)

    # 1. Standard PNG sizes for assets/logo
    sizes = [16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512, 1024]
    
    # Save original master copy
    img.save(os.path.join(assets_dir, "logo.png"), format="PNG", optimize=True)
    
    for s in sizes:
        resized = img.resize((s, s), Image.Resampling.LANCZOS)
        resized.save(os.path.join(assets_dir, f"logo-{s}x{s}.png"), format="PNG", optimize=True)
        if s == 180:
            resized.save(os.path.join(assets_dir, "apple-touch-icon.png"), format="PNG", optimize=True)
        elif s == 192:
            resized.save(os.path.join(assets_dir, "android-chrome-192x192.png"), format="PNG", optimize=True)
        elif s == 512:
            resized.save(os.path.join(assets_dir, "android-chrome-512x512.png"), format="PNG", optimize=True)

    # Specific mstile (150x150)
    mstile = img.resize((150, 150), Image.Resampling.LANCZOS)
    mstile.save(os.path.join(assets_dir, "mstile-150x150.png"), format="PNG", optimize=True)

    # Multi-size ICO for Windows & web
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(os.path.join(assets_dir, "favicon.ico"), format="ICO", sizes=ico_sizes)
    img.save(os.path.join(assets_dir, "logo.ico"), format="ICO", sizes=ico_sizes)

    # 2. Desktop build resources (electron-builder)
    img.save(os.path.join(desktop_build_dir, "icon.ico"), format="ICO", sizes=ico_sizes)
    img.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(desktop_build_dir, "icon.png"), format="PNG", optimize=True)
    img.resize((1024, 1024), Image.Resampling.LANCZOS).save(os.path.join(desktop_build_dir, "icon-1024.png"), format="PNG", optimize=True)

    for s in [16, 24, 32, 48, 64, 128, 256, 512, 1024]:
        resized = img.resize((s, s), Image.Resampling.LANCZOS)
        resized.save(os.path.join(desktop_icons_dir, f"{s}x{s}.png"), format="PNG", optimize=True)

    # 3. Renderer public assets
    img.save(os.path.join(renderer_public_dir, "favicon.ico"), format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])
    img.resize((16, 16), Image.Resampling.LANCZOS).save(os.path.join(renderer_public_dir, "favicon-16x16.png"), format="PNG", optimize=True)
    img.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(renderer_public_dir, "favicon-32x32.png"), format="PNG", optimize=True)
    img.resize((48, 48), Image.Resampling.LANCZOS).save(os.path.join(renderer_public_dir, "favicon-48x48.png"), format="PNG", optimize=True)
    img.resize((180, 180), Image.Resampling.LANCZOS).save(os.path.join(renderer_public_dir, "apple-touch-icon.png"), format="PNG", optimize=True)
    img.resize((192, 192), Image.Resampling.LANCZOS).save(os.path.join(renderer_public_dir, "logo-192.png"), format="PNG", optimize=True)
    img.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(renderer_public_dir, "logo-512.png"), format="PNG", optimize=True)
    img.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(renderer_public_dir, "logo.png"), format="PNG", optimize=True)

    # 4. OpenGraph Social Share Banner (1200x630)
    bg = Image.new("RGBA", (1200, 630), (14, 15, 20, 255))
    logo_banner_size = 440
    logo_banner = img.resize((logo_banner_size, logo_banner_size), Image.Resampling.LANCZOS)
    pos_x = (1200 - logo_banner_size) // 2
    pos_y = (630 - logo_banner_size) // 2
    bg.paste(logo_banner, (pos_x, pos_y), logo_banner)
    bg.save(os.path.join(assets_dir, "og-banner-1200x630.png"), format="PNG", optimize=True)

    # 5. Web manifest
    manifest_content = """{
  "name": "lnwjud",
  "short_name": "lnwjud",
  "icons": [
    {
      "src": "/favicon-16x16.png",
      "sizes": "16x16",
      "type": "image/png"
    },
    {
      "src": "/favicon-32x32.png",
      "sizes": "32x32",
      "type": "image/png"
    },
    {
      "src": "/logo-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/logo-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "theme_color": "#0e0f14",
  "background_color": "#0e0f14",
  "display": "standalone"
}
"""
    with open(os.path.join(renderer_public_dir, "site.webmanifest"), "w", encoding="utf-8") as f:
        f.write(manifest_content)
    with open(os.path.join(assets_dir, "site.webmanifest"), "w", encoding="utf-8") as f:
        f.write(manifest_content)

    print("All logos and icon formats generated successfully!")

if __name__ == "__main__":
    generate()
