#!/usr/bin/env python3
"""
Dynamic inventory script for Ansible to read Terraform outputs from infra/ directory.
Supports Master node (public IP) and Worker nodes (private IP via ProxyJump through Master).
"""
import json
import subprocess
import os
import sys

def get_tf_output():
    # infra directory is ../../infra relative to this file
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    infra_dir = os.path.join(base_dir, 'infra')
    try:
        out = subprocess.check_output(['terraform', 'output', '-json'], cwd=infra_dir)
        return json.loads(out)
    except Exception as e:
        sys.stderr.write(f"Warning: Could not fetch terraform output ({e})\n")
        return {}

def main():
    tf_data = get_tf_output()

    master_ip = tf_data.get('master_public_ip', {}).get('value')
    master_private_ip = tf_data.get('master_private_ip', {}).get('value')
    worker_ips = tf_data.get('worker_private_ips', {}).get('value', [])
    karpenter_node_instance_profile = tf_data.get('karpenter_node_instance_profile_name', {}).get('value')
    karpenter_interruption_queue = tf_data.get('karpenter_interruption_queue_name', {}).get('value')

    inventory = {
        "_meta": {
            "hostvars": {}
        },
        "all": {
            "children": ["master", "workers"]
        },
        "master": {
            "hosts": []
        },
        "workers": {
            "hosts": []
        }
    }

    if master_ip:
        master_host = "master-node"
        inventory["master"]["hosts"].append(master_host)
        inventory["_meta"]["hostvars"][master_host] = {
            "ansible_host": master_ip,
            "private_ip": master_private_ip or master_ip
        }
        if karpenter_node_instance_profile:
            inventory["_meta"]["hostvars"][master_host]["karpenter_node_instance_profile_name"] = karpenter_node_instance_profile
        if karpenter_interruption_queue:
            inventory["_meta"]["hostvars"][master_host]["karpenter_interruption_queue_name"] = karpenter_interruption_queue

    if worker_ips and isinstance(worker_ips, list):
        for idx, w_ip in enumerate(worker_ips):
            worker_host = f"worker-node-{idx+1}"
            inventory["workers"]["hosts"].append(worker_host)
            host_vars = {
                "ansible_host": w_ip,
                "private_ip": w_ip
            }
            if master_ip:
                host_vars["ansible_ssh_common_args"] = f"-o ProxyJump=ubuntu@{master_ip} -o StrictHostKeyChecking=no"
            inventory["_meta"]["hostvars"][worker_host] = host_vars

    # Output inventory in JSON format
    print(json.dumps(inventory, indent=2))

if __name__ == "__main__":
    main()
