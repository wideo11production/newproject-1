'use client';

import { useState, useEffect } from 'react';

interface AuraFpsGateProps {
  maxFps: number;
  currentFps: number;
  onFpsChange: (fps: number) => void;
  isAura: boolean;
  isSuperadmin: boolean;
  session: {
    email: string;
    maxFps: number;
    plan: string;
  };
  audioLevels: {
    left: number;
    right: number;
  };
}

export default function AuraFpsGate({
  maxFps,
  currentFps,
  onFpsChange,
  isAura,
  isSuperadmin,
  session,
  audioLevels,
}: AuraFpsGateProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    if (isAura) {
      const interval = setInterval(() => setPulse((p) => !p), 1000);
      return () => clearInterval(interval);
    }
  }, [isAura]);

  const availableFpsOptions = [120, 240].filter((fps) => {
    if (isSuperadmin || session.email === 'advchashampalup@gmail.com') {
      return true;
    }
    return fps <= maxFps;
  });

  const handleFpsChange = (fps: number) => {
    if (availableFpsOptions.includes(fps)) {
      onFpsChange(fps);
    }
    setIsDropdownOpen(false);
  };

  const vuGradient = 'linear-gradient(90deg, #22c55e 0%, #fbbf24 33%, #ff6500 66%, #ef4444 100%)';

  return (
    <div
      style={{
        background: '#0d0d0d',
        borderRadius: '0.375rem',
        padding: '0.75rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#ffffff',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span
          style={{
            width: '0.5rem',
            height: '0.5rem',
            borderRadius: '50%',
            background: '#22c55e',
            opacity: pulse && isAura ? 1 : 0.4,
            transition: 'opacity 500ms ease',
            boxShadow: pulse && isAura ? '0 0 8px #22c55e80' : 'none',
          }}
          aria-hidden="true"
        />
        <span
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: isAura ? '#22c55e' : '#ffffff',
          }}
        >
          {isAura ? 'AURA Active' : 'Standard'}
        </span>
        {isSuperadmin && (
          <span
            style={{
              fontSize: '0.625rem',
              padding: '0.125rem 0.375rem',
              background: '#ff6500',
              borderRadius: '0.25rem',
              color: '#0d0d0d',
              fontWeight: 700,
            }}
          >
            SUPERADMIN
          </span>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.5rem 0.75rem',
            background: 'transparent',
            border: '1px solid #2a2a2a',
            borderRadius: '0.375rem',
            color: '#ffffff',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'border-color 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#ff6500';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#2a2a2a';
          }}
        >
          <span>{currentFps} FPS</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{
              transition: 'transform 150ms ease',
              transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {isDropdownOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 0.25rem)',
              left: 0,
              right: 0,
              background: '#0d0d0d',
              border: '1px solid #2a2a2a',
              borderRadius: '0.375rem',
              overflow: 'hidden',
              zIndex: 50,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
            }}
          >
            {availableFpsOptions.map((fps) => (
              <button
                key={fps}
                onClick={() => handleFpsChange(fps)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  border: 'none',
                  color: currentFps === fps ? '#ff6500' : '#ffffff',
                  fontSize: '0.875rem',
                  fontWeight: currentFps === fps ? 600 : 400,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#1a1a1a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {fps} FPS
                {fps > maxFps && !isSuperadmin && session.email !== 'advchashampalup@gmail.com' && (
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.625rem', color: '#ff6500' }}>
                    (AURA required)
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.375rem',
          paddingTop: '0.25rem',
        }}
      >
        {['left', 'right'].map((channel) => (
          <div key={channel} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                width: '1.25rem',
                fontSize: '0.625rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: '#888',
                letterSpacing: '0.05em',
              }}
            >
              {channel.toUpperCase()}
            </span>
            <div
              style={{
                flex: 1,
                height: '0.5rem',
                background: '#1a1a1a',
                borderRadius: '0.25rem',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(1, audioLevels[channel as 'left' | 'right']) * 100)}%`,
                  height: '100%',
                  background: vuGradient,
                  borderRadius: '0.25rem',
                  transition: 'width 50ms linear',
                }}
              />
            </div>
            <span
              style={{
                width: '2.5rem',
                fontSize: '0.625rem',
                fontWeight: 600,
                color: '#ff6500',
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {Math.round(audioLevels[channel as 'left' | 'right'] * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
