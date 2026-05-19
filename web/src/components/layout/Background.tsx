import { useMemo } from "react";
import Particles, { ParticlesProvider } from "@tsparticles/react";
import { type Container, type Engine, type ISourceOptions } from "@tsparticles/engine";
import { loadSlim } from "@tsparticles/slim";

const particlesInit = async (engine: Engine): Promise<void> => {
  // loadSlim cung cấp các tính năng cơ bản như hình dạng (shape), di chuyển (move), liên kết (links), v.v.
  // giúp tối ưu hóa dung lượng bundle thay vì tải toàn bộ thư viện.
  await loadSlim(engine);
};

export const Background = () => {
  const particlesLoaded = async (container?: Container): Promise<void> => {
    console.log("Particles container loaded", container);
  };

  const options: ISourceOptions = useMemo(
    () => ({
      background: {
        color: {
          value: "transparent", // Nền trong suốt để hiển thị màu nền của ứng dụng
        },
      },
      fpsLimit: 60,
      interactivity: {
        events: {
          onHover: {
            enable: true,
            mode: "grab", // Khi di chuột vào, các đường kẻ sẽ bám lấy chuột
          },
        },
        modes: {
          push: {
            quantity: 3,
          },
          grab: {
            distance: 140,
            links: {
              opacity: 0.5,
            },
          },
        },
      },
      particles: {
        color: {
          value: "#334155", // Màu Slate-700 (Xám đậm)
        },
        links: {
          color: "#475569", // Màu Slate-600
          distance: 150,
          enable: true,
          opacity: 0.3,
          width: 1,
        },
        move: {
          direction: "none",
          enable: true,
          outModes: {
            default: "bounce", // Hạt sẽ nảy lại khi chạm viền màn hình
          },
          random: true,
          speed: 1.2,
          straight: false,
        },
        number: {
          density: {
            enable: true,
            width: 800,
            height: 800
          },
          value: 80, // Số lượng hạt vừa phải để giống chòm sao
        },
        opacity: {
          value: { min: 0.3, max: 0.7 },
        },
        shape: {
          type: "circle",
        },
        size: {
          value: { min: 1, max: 3 },
        },
      },
      detectRetina: true,
    }),
    []
  );

  return (
    <ParticlesProvider init={particlesInit}>
      <Particles
        id="tsparticles-background"
        particlesLoaded={particlesLoaded}
        options={options}
        className="absolute inset-0 z-0 w-full h-full"
      />
    </ParticlesProvider>
  );
};
