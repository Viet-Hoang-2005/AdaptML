import { Brain, RefreshCw, GitBranch, BarChart3, ChevronRight } from 'lucide-react';
import MLdriftLogo from '../../assets/icons/MLdrift.png';

const features = [
  {
    icon: Brain,
    title: 'Deploy Model',
    description: 'Upload ML models from any framework and get instant API endpoints.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  {
    icon: BarChart3,
    title: 'Drift Monitoring',
    description: 'Real-time data drift detection powered by Evidently AI.',
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
  },
  {
    icon: RefreshCw,
    title: 'Model Training',
    description: 'Automated distributed training pipelines powered by Kubeflow & Karpenter.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
  {
    icon: GitBranch,
    title: 'Model Evolution',
    description: 'Full model lifecycle management with versioning and lineage tracking.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
];

export function Cover() {
  return (
    <div className="hidden lg:flex lg:w-2/3 relative overflow-hidden bg-[#0a0a0b]">
      {/* Dynamic Background */}
      <div className="absolute inset-0">
        {/* Main Gradient Mesh */}
        <div className="absolute top-[-10%] left-[-10%] w-[70%] h-[70%] bg-blue-600/30 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-indigo-600/20 rounded-full blur-[100px]" />
        
        {/* Grid Pattern overlay */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150"></div>
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.05) 1px, transparent 0)', backgroundSize: '32px 32px' }}></div>
      </div>

      {/* Content Container */}
      <div className="relative z-10 flex flex-col justify-center px-16 xl:px-24 w-full">
        {/* Logo Section */}
        <div className="flex items-center gap-5 mb-6">
          <div className="p-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md shadow-2xl shadow-blue-500/10">
            <img src={MLdriftLogo} alt="MLdrift" className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold text-white tracking-tighter leading-none">
              <span className="text-transparent bg-clip-text bg-linear-to-r from-blue-400 to-cyan-300">ML</span>
              <span className="italic">drift</span>
            </h1>
            <p className="text-gray-400 text-xs font-semibold mt-1 tracking-wide uppercase">AI Model Platform as a Service</p>
          </div>
        </div>

        {/* Hero Text */}
        <div className="max-w-xl mb-6">
          <h2 className="text-4xl font-extrabold text-white leading-[1.1] mb-6 tracking-tight">
            Deploy your AI models <br/>
            <span className="text-transparent bg-clip-text bg-linear-to-r from-blue-400 via-cyan-300 to-emerald-300">
              to production.
            </span>
          </h2>
          <p className="text-gray-400 text-md leading-relaxed font-medium">
            The intelligent MLOps gateway. Deploy, monitor, and scale models 
            from any framework with <span className="text-white">zero configuration</span> and enterprise-grade security.
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-2 gap-4 max-w-2xl">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group relative p-5 rounded-2xl bg-white/3 border border-white/10 backdrop-blur-md
                         hover:bg-white/6 hover:border-white/20 transition duration-300
                         hover:-translate-y-1 cursor-default"
            >
              <div className={`w-10 h-10 rounded-xl ${feature.bg} flex items-center justify-center mb-4 transition-transform group-hover:scale-110 duration-300`}>
                <feature.icon className={`w-5 h-5 ${feature.color}`} />
              </div>
              <h3 className="text-white font-bold text-md mb-1 flex items-center gap-2">
                {feature.title}
                <ChevronRight className="w-3 h-3 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition duration-300" />
              </h3>
              
              {/* Subtle bottom glow on hover */}
              <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-linear-to-r from-transparent via-current to-transparent opacity-0 group-hover:opacity-20 transition-opacity ${feature.color}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
