import React from 'react';

const BAR_COUNT = 5;
const multipliers = [0.6, 0.9, 1.0, 0.85, 0.65];

export default function VoiceIndicator({ audioLevel = 0, isActive = false, label = '', color = 'accent' }) {
  return (
    <div className={`voice-indicator ${isActive ? 'voice-indicator--active' : ''}`} data-color={color}>
      <div className="voice-bars">
        {Array.from({ length: BAR_COUNT }).map((_, i) => {
          const height = isActive
            ? Math.max(6, audioLevel * 40 * multipliers[i])
            : 6;
          return (
            <div
              key={i}
              className="voice-bar"
              style={{
                height: `${height}px`,
                animationDelay: `${i * 0.08}s`,
              }}
            />
          );
        })}
      </div>
      {label && <span className="voice-label">{label}</span>}
    </div>
  );
}
