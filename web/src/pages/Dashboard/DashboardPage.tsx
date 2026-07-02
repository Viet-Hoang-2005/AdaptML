import { Activity, Boxes, Cpu, GitBranch, LineChart, Rocket, UploadCloud } from 'lucide-react';
import Placeholder from '../../components/layout/Placeholder';

export const homePlaceholders = {
  modelApi: (
    <Placeholder
      title="Model API"
      description="Upload an MLflow MLmodel package, connect it to FastAPI, and monitor endpoint status from this workspace."
      icon={<UploadCloud className="h-6 w-6" />}
    />
  ),
  benchmark: (
    <Placeholder
      title="Benchmark Model"
      description="Upload a CSV dataset and send benchmark requests to the selected model endpoint to inspect API predictions."
      icon={<Activity className="h-6 w-6" />}
    />
  ),
  modelManagement: (
    <Placeholder
      title="Model Management"
      description="Review connected models, their generated API endpoints, and lifecycle state for the selected workspace."
      icon={<Boxes className="h-6 w-6" />}
    />
  ),
};

export const dashboardPlaceholders = {
  driftMonitoring: (
    <Placeholder
      title="Drift Monitoring"
      description="Upload reference training data and compare it with production data using Evidently AI drift reports."
      icon={<LineChart className="h-6 w-6" />}
    />
  ),
  modelTraining: (
    <Placeholder
      title="Model Training"
      description="Submit new training data and Python source code for Kubeflow distributed training jobs with Karpenter autoscaling when model quality drops."
      icon={<Cpu className="h-6 w-6" />}
    />
  ),
  modelEvolution: (
    <Placeholder
      title="Model Evolution"
      description="Track model versions, metrics, and production promotion history through the MLflow Model Registry."
      icon={<GitBranch className="h-6 w-6" />}
    />
  ),
  notifications: (
    <Placeholder
      title="Notifications"
      showModelName={false}
      description="Model deployment events, drift alerts, retraining results, and API status notifications will appear here."
      icon={<Rocket className="h-6 w-6" />}
    />
  ),
};
