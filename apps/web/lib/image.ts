const MAX_IMAGE_DIMENSION = 640;

// Resizes/compresses in the browser and returns a data: URI — no object
// storage is wired up for stream/schedule thumbnails (Section 4), and a
// compressed JPEG this size is small enough to just store inline (see
// createStreamSchema/createScheduledStreamSchema's own thumbnailUrl
// comment). Extracted from GoLivePanel.tsx (its original owner) once
// ScheduleStreamPanel.tsx needed the exact same browser-side compression,
// not stream-specific in any way.
export function fileToCompressedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Couldn't process that image"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Couldn't read that image file"));
    };
    img.src = objectUrl;
  });
}
