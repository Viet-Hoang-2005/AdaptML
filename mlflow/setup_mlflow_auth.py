import os
import sys
import argparse
from mlflow.server.auth.client import AuthServiceClient

def main():
    parser = argparse.ArgumentParser(description="Manage MLflow Built-in Auth Users & Permissions")
    parser.add_argument("--tracking-uri", default="https://mlflow.mlops-nids-nt114.id.vn", help="URL of MLflow Server")
    parser.add_argument("--admin-user", default="admin", help="Current Admin Username")
    parser.add_argument("--admin-password", required=True, help="Current Admin Password")
    parser.add_argument("--new-admin-password", required=True, help="New Admin Password")
    parser.add_argument("--ai-engineer-password", required=True, help="AI Engineer Password")
    
    args = parser.parse_args()

    # Cấu hình biến môi trường để MLflow Client có thể đăng nhập bằng tài khoản Admin hiện tại
    os.environ["MLFLOW_TRACKING_USERNAME"] = args.admin_user
    os.environ["MLFLOW_TRACKING_PASSWORD"] = args.admin_password
    os.environ["MLFLOW_TRACKING_URI"] = args.tracking_uri

    print(f"[0/3] Connecting to MLflow Server: {args.tracking_uri}")
    try:
        client = AuthServiceClient(args.tracking_uri)
    except Exception as e:
        print(f"Error connecting: {e}")
        sys.exit(1)

    # 1. Khởi tạo tài khoản AI Engineer
    print("\n[1/3] Setting up User Account...")
    try:
        client.create_user(username="ai-engineer", password=args.ai_engineer_password)
        print("Successfully created account: 'ai-engineer'")
    except Exception as e:
        if "already exists" in str(e).lower() or "409" in str(e):
            client.update_user_password(username="ai-engineer", password=args.ai_engineer_password)
            print("Account 'ai-engineer' already exists. Updated password.")
        else:
            print(f"Error when creating account 'ai-engineer': {e}")

    # 2. Phân quyền (RBAC)
    print("\n[2/3] Setting up Permissions...")
    try:
        # Giả định Experiment "0" là Default, cấp quyền EDIT cho phép push metric/model
        client.create_experiment_permission(experiment_id="0", username="ai-engineer", permission="EDIT")
        print("Granted EDIT permission to 'ai-engineer' on Experiment '0' (Default)")
    except Exception as e:
        if "already exists" in str(e).lower() or "409" in str(e):
             print("EDIT permission on Experiment '0' is already configured.")
        else:
            print(f"Skipping Experiment 0 permission (may not exist yet): {e}")

    try:
        # Cấp quyền READ cho Registered Model NIDS-XGBoost
        client.create_registered_model_permission(name="NIDS-XGBoost", username="ai-engineer", permission="READ")
        print("Granted READ permission to 'ai-engineer' on Model 'NIDS-XGBoost'")
    except Exception as e:
        if "already exists" in str(e).lower() or "409" in str(e):
             print("READ permission on Model 'NIDS-XGBoost' has already been configured.")
        else:
            print(f"Skipping Model permission (may not exist yet): {e}")

    # 3. Đổi mật khẩu Admin (Thực hiện CUỐI CÙNG để không làm gián đoạn các Request ở trên)
    print("\n[3/3] Updating Admin Password...")
    try:
        client.update_user_password(username=args.admin_user, password=args.new_admin_password)
        print(f"SUCCESS! Admin password has been changed to: {args.new_admin_password}")
        
    except Exception as e:
        print(f"Error when updating Admin password: {e}")

if __name__ == "__main__":
    main()
