import { HalftoneDots } from "@paper-design/shaders-react";

const TRANSITION_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 480" preserveAspectRatio="none">
    <defs>
      <linearGradient id="transition" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" />
        <stop offset="6%" stop-color="#050505" />
        <stop offset="26%" stop-color="#303030" />
        <stop offset="54%" stop-color="#7f7f7f" />
        <stop offset="78%" stop-color="#dcdcdc" />
        <stop offset="100%" stop-color="#ffffff" />
      </linearGradient>
    </defs>
    <rect width="1200" height="480" fill="url(#transition)" />
  </svg>`,
)}`;

function HalftoneTransition() {
  return (
    <div
      aria-hidden="true"
      className="relative h-[4.2rem] w-full overflow-hidden bg-background"
    >
      <HalftoneDots
        className="absolute inset-0 block h-full w-full"
        colorBack="#ffffff00"
        colorFront="#000000"
        contrast={0.84}
        grainMixer={0}
        grainOverlay={0}
        grainSize={0}
        grid="hex"
        height="100%"
        image={TRANSITION_IMAGE}
        maxPixelCount={320000}
        minPixelRatio={1}
        radius={1.28}
        size={0.97}
        type="classic"
        width="100%"
      />
    </div>
  );
}

export { HalftoneTransition };
