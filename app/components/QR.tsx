import QRCode from "qrcode";

/** A scannable QR code for a link, drawn as SVG from the code's own modules. Generated here; nothing is sent to any service. */
export function QR({ text, className = "h-36 w-36 rounded-sm bg-white p-2" }: { text: string; className?: string }) {
  const { size, data } = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
  let d = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label="QR code for this invoice’s link" shapeRendering="crispEdges">
      <path d={d} fill="#15211c" />
    </svg>
  );
}
