import glob
import json
import os
import pickle
import shutil
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def main():
    train_dir = os.environ["SM_CHANNEL_TRAIN"]
    model_dir = os.environ["SM_MODEL_DIR"]

    csv_files = sorted(glob.glob(os.path.join(train_dir, "*.csv")))
    if not csv_files:
        raise FileNotFoundError("No CSV file found in SM_CHANNEL_TRAIN")

    df = pd.read_csv(csv_files[0])
    target = "label" if "label" in df.columns else df.columns[-1]
    X = df.drop(columns=[target])
    y = df[target]

    model = Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            ("classifier", RandomForestClassifier(n_estimators=10, random_state=42)),
        ]
    )
    model.fit(X, y)

    os.makedirs(model_dir, exist_ok=True)
    with open(os.path.join(model_dir, "model.pkl"), "wb") as handle:
        pickle.dump(model, handle)

    labels = sorted(y.unique().tolist())
    label_mapping = {str(index): label for index, label in enumerate(labels)}
    with open(os.path.join(model_dir, "label_mapping.json"), "w", encoding="utf-8") as handle:
        json.dump(label_mapping, handle, indent=2)

    metadata = {
        "framework": "sklearn",
        "target": target,
        "features": X.columns.tolist(),
        "model_file": "model.pkl",
    }
    with open(os.path.join(model_dir, "model_metadata.json"), "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)

    requirements_path = Path(__file__).with_name("requirements.txt")
    if requirements_path.exists():
        shutil.copy2(requirements_path, os.path.join(model_dir, "requirements.txt"))


if __name__ == "__main__":
    main()
