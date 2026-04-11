"""Generate a product bottle image using Gemini image generation."""
import os, base64, sys
from pathlib import Path
from google import genai
from google.genai import types

# Load API key from ad-image-generator .env
env_path = Path("/Users/johncasto/ad-image-generator/.env")
for line in env_path.read_text().splitlines():
    if line.startswith("GOOGLE_AI_API_KEY="):
        os.environ["GOOGLE_AI_API_KEY"] = line.split("=", 1)[1].strip()
        break

client = genai.Client(api_key=os.environ["GOOGLE_AI_API_KEY"])

prompt = """Create a photorealistic product render of a premium prescription sleep medication bottle on a pure white background.

The bottle should be:
- A sleek, modern pharmaceutical bottle shape (like a high-end supplement or prescription bottle)
- Matte dark navy/charcoal color body
- Clean, minimal label design with gold/warm bronze accents
- The brand name "Health Renewal Rx" at the top of the label in a refined serif or sans-serif font
- The product name "Sleep Deep Rx" prominently displayed as the main text on the label, in larger elegant typography
- A subtle crescent moon icon or sleep-related motif incorporated into the label design
- "Prescription Sleep Formula" as a subtitle below the product name
- "30 Day Supply" at the bottom of the label
- Professional pharmaceutical styling — this should look like a premium telehealth brand product
- Soft studio lighting with subtle shadow
- The bottle should be centered, shot straight-on at a slight angle
- Pure clean white background for easy compositing
- High-end, trustworthy, medical aesthetic — not supplement-store cheap

Style: Professional product photography, studio lit, clean commercial render, premium healthcare brand."""

response = client.models.generate_content(
    model="gemini-3.1-flash-image-preview",
    contents=prompt,
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        temperature=0.8,
    ),
)

# Save the image
for part in response.candidates[0].content.parts:
    if part.inline_data and part.inline_data.mime_type.startswith("image/"):
        ext = "png" if "png" in part.inline_data.mime_type else "jpg"
        out_path = f"/Users/johncasto/sleep-survey-funnel/bottle.{ext}"
        with open(out_path, "wb") as f:
            f.write(part.inline_data.data)
        print(f"Saved to {out_path}")
        sys.exit(0)

print("No image generated in response")
for part in response.candidates[0].content.parts:
    if part.text:
        print(part.text)
sys.exit(1)
