from urllib.parse import quote

from django.conf import settings

from infrastructure.http import HttpClient


class HarborClient:
    def __init__(self, http=None):
        self.http = http or HttpClient()
        registry = settings.HARBOR_REGISTRY_URL
        self.base_url = (
            registry if registry.startswith(("http://", "https://")) else f"https://{registry}"
        ) if registry else ""

    @property
    def enabled(self):
        return bool(self.base_url)

    def delete_repository(self, project, repository):
        if not self.enabled:
            return
        encoded = quote(repository, safe="")
        url = f"{self.base_url}/api/v2.0/projects/{project}/repositories/{encoded}"
        self.http.request("DELETE", url, auth=(settings.HARBOR_USERNAME, settings.HARBOR_PASSWORD))

    def repositories(self, project):
        if not self.enabled:
            return []
        repositories: list[str] = []
        page = 1
        while True:
            response = self.http.request(
                "GET",
                f"{self.base_url}/api/v2.0/projects/{project}/repositories",
                params={"page": page, "page_size": 100},
                auth=(settings.HARBOR_USERNAME, settings.HARBOR_PASSWORD),
            )
            batch = response.json()
            prefix = f"{project}/"
            repositories.extend(
                item["name"][len(prefix) :] if item["name"].startswith(prefix) else item["name"]
                for item in batch
            )
            if len(batch) < 100:
                return repositories
            page += 1
