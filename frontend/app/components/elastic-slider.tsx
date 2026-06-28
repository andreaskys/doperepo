'use client';

import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './elastic-slider.css';

const MAX_OVERFLOW = 50;

interface Props {
  value?: number;
  defaultValue?: number;
  startingValue?: number;
  maxValue?: number;
  className?: string;
  isStepped?: boolean;
  stepSize?: number;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  onChange?: (v: number) => void;
}

export default function ElasticSlider({
  value,
  defaultValue = 50,
  startingValue = 0,
  maxValue = 100,
  className = '',
  isStepped = false,
  stepSize = 1,
  leftIcon = <span className="es-ic">–</span>,
  rightIcon = <span className="es-ic">+</span>,
  onChange,
}: Props) {
  const [val, setVal] = useState<number>(value ?? defaultValue);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [region, setRegion] = useState<'left' | 'middle' | 'right'>('middle');
  const clientX = useMotionValue(0);
  const overflow = useMotionValue(0);
  const scale = useMotionValue(1);

  useEffect(() => {
    if (value !== undefined) setVal(value);
  }, [value]);

  useMotionValueEvent(clientX, 'change', (latest: number) => {
    if (!sliderRef.current) return;
    const { left, right } = sliderRef.current.getBoundingClientRect();
    let newValue: number;
    if (latest < left) {
      setRegion('left');
      newValue = left - latest;
    } else if (latest > right) {
      setRegion('right');
      newValue = latest - right;
    } else {
      setRegion('middle');
      newValue = 0;
    }
    overflow.jump(decay(newValue, MAX_OVERFLOW));
  });

  const commit = (v: number) => {
    setVal(v);
    onChange?.(v);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.buttons > 0 && sliderRef.current) {
      const { left, width } = sliderRef.current.getBoundingClientRect();
      let newValue = startingValue + ((e.clientX - left) / width) * (maxValue - startingValue);
      if (isStepped) newValue = Math.round(newValue / stepSize) * stepSize;
      newValue = Math.min(Math.max(newValue, startingValue), maxValue);
      commit(newValue);
      clientX.jump(e.clientX);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    handlePointerMove(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerUp = () => {
    animate(overflow, 0, { type: 'spring', bounce: 0.5 });
  };

  const rangePct = () => {
    const total = maxValue - startingValue;
    return total === 0 ? 0 : ((val - startingValue) / total) * 100;
  };

  return (
    <div className={`slider-container ${className}`}>
      <motion.div
        onHoverStart={() => animate(scale, 1.2)}
        onHoverEnd={() => animate(scale, 1)}
        onTouchStart={() => animate(scale, 1.2)}
        onTouchEnd={() => animate(scale, 1)}
        style={{ scale, opacity: useTransform(scale, [1, 1.2], [0.7, 1]) }}
        className="slider-wrapper"
      >
        <motion.div
          animate={{ scale: region === 'left' ? [1, 1.4, 1] : 1, transition: { duration: 0.25 } }}
          style={{ x: useTransform(() => (region === 'left' ? -overflow.get() / scale.get() : 0)) }}
        >
          {leftIcon}
        </motion.div>

        <div
          ref={sliderRef}
          className="slider-root"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
        >
          <motion.div
            style={{
              scaleX: useTransform(() => {
                if (!sliderRef.current) return 1;
                const { width } = sliderRef.current.getBoundingClientRect();
                return 1 + overflow.get() / width;
              }),
              scaleY: useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.8]),
              transformOrigin: useTransform(() => {
                if (!sliderRef.current) return 'center';
                const { left, width } = sliderRef.current.getBoundingClientRect();
                return clientX.get() < left + width / 2 ? 'right' : 'left';
              }),
              height: useTransform(scale, [1, 1.2], [6, 12]),
              marginTop: useTransform(scale, [1, 1.2], [0, -3]),
              marginBottom: useTransform(scale, [1, 1.2], [0, -3]),
            }}
            className="slider-track-wrapper"
          >
            <div className="slider-track">
              <div className="slider-range" style={{ width: `${rangePct()}%` }} />
            </div>
          </motion.div>
        </div>

        <motion.div
          animate={{ scale: region === 'right' ? [1, 1.4, 1] : 1, transition: { duration: 0.25 } }}
          style={{ x: useTransform(() => (region === 'right' ? overflow.get() / scale.get() : 0)) }}
        >
          {rightIcon}
        </motion.div>
      </motion.div>
      <p className="value-indicator">{Math.round(val)}</p>
    </div>
  );
}

function decay(value: number, max: number): number {
  if (max === 0) return 0;
  const entry = value / max;
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
  return sigmoid * max;
}
