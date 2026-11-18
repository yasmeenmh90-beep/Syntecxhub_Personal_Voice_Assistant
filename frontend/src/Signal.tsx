import { memo } from "react";

/** Every point is a signed PCM sample; an inactive input renders a flat line. */
export const Signal = memo(function Signal({
  samples,
  active,
  className = "",
}: {
  samples: number[];
  active: boolean;
  className?: string;
}) {
  const values = active && samples.length ? samples : Array<number>(64).fill(0);
  const points = values
    .map(
      (sample, index) =>
        `${(index * 480) / (values.length - 1)},${45 - Math.max(-1, Math.min(1, sample)) * 38}`,
    )
    .join(" ");
  return (
    <svg
      className={"signal-wave " + className}
      viewBox="0 0 480 90"
      role="img"
      aria-label={
        active ? "Live microphone waveform" : "Microphone waveform inactive"
      }
      preserveAspectRatio="none"
    >
      <path className="signal-axis" d="M0 45H480" />
      <polyline points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
});
