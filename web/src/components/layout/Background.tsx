import { useMemo, type CSSProperties } from 'react';

const colors = ['#f9a0cf', '#ffb46a', '#a58ef9', '#ffe180', '#85b4d8', '#7dd3fc'];

type ParticleStyle = CSSProperties & {
  '--dx': string;
  '--dy': string;
  '--scale': number;
};

const createParticleStyle = (index: number): ParticleStyle => {
  const left = (index * 37) % 100;
  const top = (index * 53) % 100;
  const size = 10 + ((index * 11) % 24);
  const dx = -70 + ((index * 29) % 140);
  const dy = -55 + ((index * 41) % 110);
  const duration = 5 + ((index * 7) % 8);
  const delay = -((index * 3) % duration);

  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${size}px`,
    height: `${size}px`,
    backgroundColor: colors[index % colors.length],
    opacity: 0.26 + ((index * 13) % 30) / 100,
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`,
    '--dx': `${dx}px`,
    '--dy': `${dy}px`,
    '--scale': 0.75 + ((index * 5) % 45) / 100,
  };
};

export const Background = () => {
  const particles = useMemo(
    () => Array.from({ length: 70 }, (_, index) => createParticleStyle(index)),
    [],
  );

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <style>
        {`
          @keyframes mldrift-particle-float {
            0% {
              transform: translate3d(0, 0, 0) scale(1);
            }
            100% {
              transform: translate3d(var(--dx), var(--dy), 0) scale(var(--scale));
            }
          }
        `}
      </style>

      {particles.map((style, index) => (
        <span
          key={index}
          className="absolute rounded-full mix-blend-multiply shadow-sm"
          style={{
            ...style,
            animationName: 'mldrift-particle-float',
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
            animationDirection: 'alternate',
          }}
        />
      ))}
    </div>
  );
};
