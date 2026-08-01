from common.api.exceptions import ServiceUnavailable

from infrastructure.http import HttpClient


class ArgoWebhookClient:
    def __init__(self, http=None):
        self.http = http or HttpClient()

    def trigger(self, url, payload, headers=None):
        if not url:
            raise ServiceUnavailable("Argo webhook URL is not configured.")
        return self.http.request("POST", url, json=payload, headers=headers or {}).json()
