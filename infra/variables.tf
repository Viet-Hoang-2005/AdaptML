variable "github_repo" {
  description = "The GitHub repository in the format username/repo"
  type        = string
}

variable "github_token" {
  description = "A GitHub personal access token with repo permissions"
  type        = string
  sensitive   = true
}
