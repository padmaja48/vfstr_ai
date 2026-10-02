const units: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

export const durationToSeconds = (value: string, fallbackSeconds: number) => {
  const match = value.trim().match(/^(\d+)([smhd])$/i);
  if (!match) {
    return fallbackSeconds;
  }

  return Number(match[1]) * units[match[2].toLowerCase()];
};
