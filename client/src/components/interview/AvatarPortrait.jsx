import React, { useState, useEffect, useRef } from 'react';

/* ── Inline SVG portraits with built-in SVG eyelid blink ── */

// Eyelid shape that covers the eye — drawn as a closed lid (SVG path)
// Each face renders eyelids conditionally based on `blinking` prop

// Ryan Carter — light skin, short brown hair, male features
const FaceRyan = ({ mouthOpen, blinking }) => (
  <svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    {/* Background */}
    <rect width="200" height="220" fill="#d8e8f8" />
    {/* Neck — wider for male */}
    <rect x="78" y="158" width="44" height="40" rx="5" fill="#f0d0b0" />
    {/* Shoulders — suit jacket */}
    <ellipse cx="100" cy="218" rx="75" ry="28" fill="#1c2e4a" />
    {/* Lapels */}
    <path d="M74 185 Q100 200 126 185" stroke="#2a3f60" strokeWidth="2" fill="none" />
    <path d="M88 186 L100 218 L112 186" fill="#243552" />
    {/* Shirt collar white */}
    <path d="M82 182 Q100 194 118 182" stroke="#ffffff" strokeWidth="3" fill="none" />
    {/* Face — wider/squarer jaw */}
    <ellipse cx="100" cy="106" rx="58" ry="64" fill="#f0d0b0" />
    {/* Jaw squaring */}
    <rect x="50" y="118" width="100" height="46" rx="14" fill="#f0d0b0" />
    {/* Short neat hair — side parted, brown */}
    <ellipse cx="100" cy="54" rx="59" ry="30" fill="#7a5228" />
    {/* Hair side fade */}
    <ellipse cx="46" cy="75" rx="12" ry="22" fill="#7a5228" />
    <ellipse cx="154" cy="75" rx="12" ry="22" fill="#7a5228" />
    {/* Side part line */}
    <path d="M72 42 Q78 58 80 68" stroke="#5a3810" strokeWidth="2" fill="none" />
    {/* Ears — larger for male */}
    <ellipse cx="42" cy="108" rx="10" ry="14" fill="#f0d0b0" />
    <ellipse cx="158" cy="108" rx="10" ry="14" fill="#f0d0b0" />
    {/* Ear inner */}
    <ellipse cx="42" cy="108" rx="5" ry="8" fill="#e0b898" />
    <ellipse cx="158" cy="108" rx="5" ry="8" fill="#e0b898" />
    {/* Eyebrows — thick, flat, masculine */}
    <path d="M66 86 Q80 81 93 86" stroke="#5a3810" strokeWidth="4" fill="none" strokeLinecap="round" />
    <path d="M107 86 Q120 81 134 86" stroke="#5a3810" strokeWidth="4" fill="none" strokeLinecap="round" />
    {/* Eyes whites */}
    <ellipse cx="80" cy="101" rx="13" ry="9" fill="white" />
    <ellipse cx="120" cy="101" rx="13" ry="9" fill="white" />
    {/* Irises + pupils (hidden when blinking) */}
    {!blinking && <>
      <circle cx="80" cy="102" r="6" fill="#3d6ea0" />
      <circle cx="120" cy="102" r="6" fill="#3d6ea0" />
      <circle cx="80" cy="102" r="3.2" fill="#111" />
      <circle cx="120" cy="102" r="3.2" fill="#111" />
      <circle cx="81.5" cy="100.5" r="1.4" fill="white" />
      <circle cx="121.5" cy="100.5" r="1.4" fill="white" />
    </>}
    {/* Eyelids when blinking */}
    {blinking && <>
      <ellipse cx="80" cy="101" rx="13" ry="9" fill="#f0d0b0" />
      <ellipse cx="120" cy="101" rx="13" ry="9" fill="#f0d0b0" />
      <path d="M67 101 Q80 95 93 101" stroke="#c09870" strokeWidth="1.2" fill="none" />
      <path d="M107 101 Q120 95 133 101" stroke="#c09870" strokeWidth="1.2" fill="none" />
    </>}
    {/* Nose — wider, straighter male nose */}
    <path d="M97 111 L96 126" stroke="#c09870" strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M103 111 L104 126" stroke="#c09870" strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M92 126 Q100 130 108 126" stroke="#c09870" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    {/* Light stubble shadow around jaw */}
    <ellipse cx="100" cy="150" rx="32" ry="16" fill="#c0946a" opacity="0.2" />
    <ellipse cx="78" cy="148" rx="10" ry="8" fill="#b08050" opacity="0.15" />
    <ellipse cx="122" cy="148" rx="10" ry="8" fill="#b08050" opacity="0.15" />
    {/* Mouth */}
    {mouthOpen > 0.3 ? (
      <path d={`M83 139 Q100 ${149 + mouthOpen * 10} 117 139`} stroke="#a07050" strokeWidth="1.5" fill="#7a3820" />
    ) : (
      <path d="M83 139 Q100 145 117 139" stroke="#a07050" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    )}
    {/* Subtle nasolabial lines for realism */}
    <path d="M82 132 Q79 140 83 146" stroke="#c09070" strokeWidth="1" fill="none" opacity="0.4" />
    <path d="M118 132 Q121 140 117 146" stroke="#c09070" strokeWidth="1" fill="none" opacity="0.4" />
  </svg>
);

// Priya Sharma — medium-brown skin, long dark hair, female features
const FacePriya = ({ mouthOpen, blinking }) => (
  <svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect width="200" height="220" fill="#f5e6d5" />
    <rect x="82" y="158" width="36" height="38" rx="6" fill="#c8845a" />
    <ellipse cx="100" cy="215" rx="70" ry="28" fill="#8b2252" />
    <ellipse cx="100" cy="108" rx="56" ry="66" fill="#c8845a" />
    <rect x="38" y="60" width="24" height="130" rx="12" fill="#1a0a00" />
    <rect x="138" y="60" width="24" height="130" rx="12" fill="#1a0a00" />
    <ellipse cx="100" cy="54" rx="57" ry="32" fill="#1a0a00" />
    <path d="M100 28 L100 60" stroke="#2d1200" strokeWidth="3" />
    <path d="M68 87 Q80 82 91 87" stroke="#1a0a00" strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M109 87 Q120 82 132 87" stroke="#1a0a00" strokeWidth="3" fill="none" strokeLinecap="round" />
    <ellipse cx="80" cy="102" rx="13" ry="9" fill="white" />
    <ellipse cx="120" cy="102" rx="13" ry="9" fill="white" />
    {!blinking && <>
      <circle cx="80" cy="103" r="6" fill="#3d1c00" />
      <circle cx="120" cy="103" r="6" fill="#3d1c00" />
      <circle cx="80" cy="103" r="3.2" fill="#111" />
      <circle cx="120" cy="103" r="3.2" fill="#111" />
      <circle cx="82" cy="101" r="1.4" fill="white" />
      <circle cx="122" cy="101" r="1.4" fill="white" />
      <path d="M67 102 Q80 96 93 102" stroke="#1a0a00" strokeWidth="1.5" fill="none" />
      <path d="M107 102 Q120 96 133 102" stroke="#1a0a00" strokeWidth="1.5" fill="none" />
    </>}
    {blinking && <>
      <ellipse cx="80" cy="102" rx="13" ry="9" fill="#c8845a" />
      <ellipse cx="120" cy="102" rx="13" ry="9" fill="#c8845a" />
      <path d="M67 102 Q80 96 93 102" stroke="#8a5030" strokeWidth="1.2" fill="none" />
      <path d="M107 102 Q120 96 133 102" stroke="#8a5030" strokeWidth="1.2" fill="none" />
    </>}
    <path d="M96 114 Q100 125 104 114" stroke="#a0613a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    <ellipse cx="96" cy="123" rx="4" ry="2.5" fill="#a0613a" opacity="0.5" />
    <ellipse cx="104" cy="123" rx="4" ry="2.5" fill="#a0613a" opacity="0.5" />
    <circle cx="100" cy="77" r="3" fill="#cc0000" />
    {mouthOpen > 0.3 ? (
      <path d={`M84 140 Q100 ${150 + mouthOpen * 10} 116 140`} stroke="#8b3030" strokeWidth="1.5" fill="#6b1a1a" />
    ) : (
      <path d="M84 140 Q100 147 116 140" stroke="#8b3030" strokeWidth="2" fill="none" strokeLinecap="round" />
    )}
    <ellipse cx="44" cy="108" rx="8" ry="11" fill="#c8845a" />
    <ellipse cx="156" cy="108" rx="8" ry="11" fill="#c8845a" />
    <circle cx="44" cy="114" r="4" fill="#c8a000" />
    <path d="M40 118 L44 126 L48 118" fill="#c8a000" />
    <circle cx="156" cy="114" r="4" fill="#c8a000" />
    <path d="M152 118 L156 126 L160 118" fill="#c8a000" />
  </svg>
);

// Alternate male portrait
const FaceJames = ({ mouthOpen, blinking }) => (
  <svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect width="200" height="220" fill="#e8f5ec" />
    <rect x="80" y="158" width="40" height="40" rx="5" fill="#f0d8c0" />
    <ellipse cx="100" cy="215" rx="72" ry="28" fill="#1e3a5f" />
    <path d="M76 185 Q100 198 124 185" stroke="#ffffff" strokeWidth="3" fill="none" />
    <path d="M96 188 L100 210 L104 188" fill="#c0392b" />
    <ellipse cx="100" cy="108" rx="56" ry="64" fill="#f0d8c0" />
    <rect x="50" y="120" width="100" height="44" rx="10" fill="#f0d8c0" />
    <ellipse cx="100" cy="56" rx="57" ry="30" fill="#8b6040" />
    <ellipse cx="78" cy="50" rx="20" ry="12" fill="#7a5030" />
    <ellipse cx="122" cy="50" rx="20" ry="12" fill="#7a5030" />
    <ellipse cx="44" cy="108" rx="9" ry="13" fill="#f0d8c0" />
    <ellipse cx="156" cy="108" rx="9" ry="13" fill="#f0d8c0" />
    <path d="M67 87 Q79 82 91 87" stroke="#6b4820" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    <path d="M109 87 Q121 82 133 87" stroke="#6b4820" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    <ellipse cx="79" cy="102" rx="13" ry="9" fill="white" />
    <ellipse cx="121" cy="102" rx="13" ry="9" fill="white" />
    {!blinking && <>
      <circle cx="79" cy="103" r="6.5" fill="#4d7a4d" />
      <circle cx="121" cy="103" r="6.5" fill="#4d7a4d" />
      <circle cx="79" cy="103" r="3.5" fill="#111" />
      <circle cx="121" cy="103" r="3.5" fill="#111" />
      <circle cx="81" cy="101" r="1.5" fill="white" />
      <circle cx="123" cy="101" r="1.5" fill="white" />
    </>}
    {blinking && <>
      <ellipse cx="79" cy="102" rx="13" ry="9" fill="#f0d8c0" />
      <ellipse cx="121" cy="102" rx="13" ry="9" fill="#f0d8c0" />
      <path d="M66 102 Q79 96 92 102" stroke="#b0906a" strokeWidth="1.2" fill="none" />
      <path d="M108 102 Q121 96 134 102" stroke="#b0906a" strokeWidth="1.2" fill="none" />
    </>}
    <path d="M95 113 Q100 126 105 113" stroke="#c0986a" strokeWidth="2" fill="none" strokeLinecap="round" />
    <ellipse cx="95" cy="124" rx="5" ry="3" fill="#c0986a" opacity="0.5" />
    <ellipse cx="105" cy="124" rx="5" ry="3" fill="#c0986a" opacity="0.5" />
    <ellipse cx="100" cy="148" rx="28" ry="14" fill="#c8a880" opacity="0.3" />
    {mouthOpen > 0.3 ? (
      <path d={`M83 140 Q100 ${150 + mouthOpen * 10} 117 140`} stroke="#a06040" strokeWidth="1.5" fill="#7a3020" />
    ) : (
      <path d="M83 140 Q100 146 117 140" stroke="#a06040" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    )}
  </svg>
);

const FACE_MAP = {
  'us-american': FaceRyan,
  'us-indian': FacePriya,
  'us-australian': FaceJames,
};

// Photo-based avatars for personas with real portrait images (no blinking)
const PHOTO_AVATARS = {
  'us-indian': '/avatars/priya-sharma.png',
  'us-australian': '/avatars/ananya-rao.png',
  'ru-russian': '/avatars/rahul-menon.png',
};

/* ── Main AvatarPortrait component ── */
export const AvatarPortrait = ({ persona, isSpeaking, audioLevel = 0, isListening = false }) => {
  const [blinking, setBlinking] = useState(false);
  const blinkTimerRef = useRef(null);
  const personaId = persona?.id;
  const portraitUrl = PHOTO_AVATARS[personaId];
  const usePhoto = Boolean(portraitUrl);

  // Only schedule blinking for SVG faces — photo avatars are static
  useEffect(() => {
    if (usePhoto) return;
    const scheduleBlink = () => {
      const delay = 2500 + Math.random() * 3500;
      blinkTimerRef.current = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 120);
      }, delay);
    };
    scheduleBlink();
    return () => clearTimeout(blinkTimerRef.current);
  }, [usePhoto]);

  const mouthOpen = isSpeaking ? Math.min(1, audioLevel * 2) : 0;
  const FaceComponent = FACE_MAP[personaId] || FaceRyan;

  return (
    <div
      className={`avatar-portrait-wrapper ${isSpeaking ? 'speaking' : ''} ${isListening ? 'listening' : ''}`}
    >
      <div className={`avatar-glow-ring ${isSpeaking ? 'active' : ''}`} />

      <div className={`avatar-img-container ${usePhoto ? 'avatar-img-container--photo' : ''}`}>
        {usePhoto ? (
          <img
            src={portraitUrl}
            alt={persona?.name}
            className="avatar-photo"
            draggable={false}
          />
        ) : (
          <FaceComponent mouthOpen={mouthOpen} blinking={blinking} />
        )}
      </div>

      <div className="avatar-nametag">
        <span className="avatar-name">{persona?.name}</span>
        <span className="avatar-title">{persona?.title}</span>
      </div>

      <div
        className={`avatar-status-badge ${
          isSpeaking ? 'badge-speaking' : isListening ? 'badge-listening' : 'badge-idle'
        }`}
      >
        {isSpeaking ? 'Speaking' : isListening ? 'Listening' : 'Waiting'}
      </div>
    </div>
  );
};
