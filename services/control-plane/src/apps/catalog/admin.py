from django.contrib import admin

from .models import ModelBuildInputAsset, ModelBuildMetadata, ModelProject, WorkspaceAsset

admin.site.register(ModelProject)
admin.site.register(WorkspaceAsset)
admin.site.register(ModelBuildMetadata)
admin.site.register(ModelBuildInputAsset)
