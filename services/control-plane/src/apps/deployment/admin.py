from django.contrib import admin

from .models import Build, Deployment, Endpoint

admin.site.register(Build)
admin.site.register(Deployment)
admin.site.register(Endpoint)
