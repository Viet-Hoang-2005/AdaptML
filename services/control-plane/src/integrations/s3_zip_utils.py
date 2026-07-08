import os
import zipfile
import tempfile
import logging
import boto3
from typing import List, Dict, Any
from django.conf import settings

logger = logging.getLogger(__name__)

MAX_UNZIPPED_SIZE = 500 * 1024 * 1024  # 500 MB
MAX_FILES = 2000

class ZipBombException(Exception):
    pass

def handle_upload_to_s3(file_obj, s3_prefix: str) -> bool:
    """
    If file_obj is a zip file, extract and upload contents.
    Otherwise, upload the single file directly under the prefix.
    """
    if file_obj.name.lower().endswith('.zip'):
        return extract_zip_and_upload_to_s3(file_obj, s3_prefix)
    else:
        if not s3_prefix.endswith('/'):
            s3_prefix += '/'
        s3_key = f"{s3_prefix}{file_obj.name}"
        # We can reuse the single file uploader
        bucket_name = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', 'mlops-paas-artifacts')
        region_name = getattr(settings, 'AWS_S3_REGION_NAME', 'ap-southeast-1')
        s3_client = boto3.client('s3', region_name=region_name)
        try:
            # Be sure to rewind file pointer
            file_obj.seek(0)
            s3_client.upload_fileobj(file_obj, bucket_name, s3_key)
            return True
        except Exception as e:
            logger.error(f"Error uploading single file to S3: {e}")
            raise e

def extract_zip_and_upload_to_s3(zip_file_obj, s3_prefix: str) -> bool:
    """
    Safely extract a ZIP file and upload all its contents to S3 under s3_prefix.
    Args:
        zip_file_obj: The uploaded file object (InMemoryUploadedFile or TemporaryUploadedFile)
        s3_prefix: The destination prefix in S3 (e.g. tenants/T-1/models/model1/v1/code/)
    """
    bucket_name = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', 'mlops-paas-artifacts')
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', 'ap-southeast-1')
    
    s3_client = boto3.client('s3', region_name=region_name)
    
    if not s3_prefix.endswith('/'):
        s3_prefix += '/'

    try:
        # Rewind file pointer before reading zip
        zip_file_obj.seek(0)
        with zipfile.ZipFile(zip_file_obj, 'r') as zf:
            total_size = 0
            file_list = zf.infolist()
            
            if len(file_list) > MAX_FILES:
                raise ZipBombException(f"Zip contains too many files (max {MAX_FILES})")
                
            for info in file_list:
                total_size += info.file_size
                if total_size > MAX_UNZIPPED_SIZE:
                    raise ZipBombException(f"Unzipped size exceeds limit ({MAX_UNZIPPED_SIZE/(1024*1024)} MB)")
            
            # Use a temporary directory to extract securely
            with tempfile.TemporaryDirectory() as tmpdir:
                zf.extractall(path=tmpdir)
                
                # Upload all extracted files to S3
                for root, dirs, files in os.walk(tmpdir):
                    for file in files:
                        local_path = os.path.join(root, file)
                        # Calculate relative path inside the zip
                        rel_path = os.path.relpath(local_path, tmpdir)
                        # Normalize path separators for S3 (S3 uses forward slash)
                        rel_path = rel_path.replace(os.sep, '/')
                        
                        s3_key = f"{s3_prefix}{rel_path}"
                        
                        # Optionally guess content type or use map
                        ExtraArgs = {}
                        if file.endswith('.csv'):
                            ExtraArgs['ContentType'] = 'text/csv'
                        elif file.endswith('.py'):
                            ExtraArgs['ContentType'] = 'text/x-python'
                        elif file.endswith('.json'):
                            ExtraArgs['ContentType'] = 'application/json'
                        elif file.endswith('.txt'):
                            ExtraArgs['ContentType'] = 'text/plain'
                            
                        s3_client.upload_file(local_path, bucket_name, s3_key, ExtraArgs=ExtraArgs)
                        
        return True
    except zipfile.BadZipFile:
        logger.error("Uploaded file is not a valid zip file")
        raise Exception("Invalid ZIP file")
    except Exception as e:
        logger.error(f"Error during zip extraction and upload: {e}")
        raise e

def get_s3_file_list(s3_prefix: str) -> List[Dict[str, Any]]:
    """
    List files in an S3 prefix and generate presigned URLs.
    """
    bucket_name = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', 'mlops-paas-artifacts')
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', 'ap-southeast-1')
    s3_client = boto3.client('s3', region_name=region_name)
    
    if not s3_prefix.endswith('/'):
        s3_prefix += '/'

    try:
        response = s3_client.list_objects_v2(Bucket=bucket_name, Prefix=s3_prefix)
        files = []
        if 'Contents' in response:
            for obj in response['Contents']:
                # Skip "directories" (0 byte objects ending with /)
                if obj['Key'].endswith('/'):
                    continue
                    
                # Generate a pre-signed URL for downloading (valid for 15 minutes)
                url = s3_client.generate_presigned_url(
                    ClientMethod='get_object',
                    Params={
                        'Bucket': bucket_name,
                        'Key': obj['Key']
                    },
                    ExpiresIn=900
                )
                
                # Get the relative path from the prefix
                rel_path = obj['Key'][len(s3_prefix):]
                
                files.append({
                    "key": obj['Key'],
                    "relative_path": rel_path,
                    "size": obj['Size'],
                    "last_modified": obj['LastModified'].isoformat() if obj.get('LastModified') else None,
                    "download_url": url
                })
        return files
    except Exception as e:
        logger.error(f"Error listing S3 objects: {e}")
        return []

def upload_single_file_to_s3(file_obj, s3_key: str):
    """
    Upload a single file/content to S3 directly.
    Used for the Save functionality in SourceEditor.
    """
    bucket_name = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', 'mlops-paas-artifacts')
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', 'ap-southeast-1')
    s3_client = boto3.client('s3', region_name=region_name)
    
    try:
        s3_client.upload_fileobj(file_obj, bucket_name, s3_key)
        return True
    except Exception as e:
        logger.error(f"Error uploading file to S3: {e}")
        raise e

def delete_s3_path(s3_key: str):
    """
    Delete a single file or a directory (prefix) from S3.
    To delete a directory, ensure s3_key ends with '/'.
    """
    bucket_name = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', 'mlops-paas-artifacts')
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', 'ap-southeast-1')
    s3_client = boto3.client('s3', region_name=region_name)
    
    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name, Prefix=s3_key)
        
        delete_us = dict(Objects=[])
        for item in pages.search('Contents'):
            if not item: continue
            delete_us['Objects'].append(dict(Key=item['Key']))
            
            if len(delete_us['Objects']) >= 1000:
                s3_client.delete_objects(Bucket=bucket_name, Delete=delete_us)
                delete_us = dict(Objects=[])
                
        if len(delete_us['Objects']):
            s3_client.delete_objects(Bucket=bucket_name, Delete=delete_us)
            
        return True
    except Exception as e:
        logger.error(f"Error deleting S3 path {s3_key}: {e}")
        raise e
