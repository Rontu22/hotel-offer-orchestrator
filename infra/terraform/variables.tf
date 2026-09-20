variable "region" {
  description = "AWS region hosting the EC2 instance."
  type        = string
  default     = "ap-south-1"
}

variable "name" {
  description = "Name prefix for every resource this stack creates."
  type        = string
  default     = "hotel-offers"
}

variable "instance_type" {
  description = "Dedicated instance for this stack. t3.micro fits it with ~530 MB spare; t3.small if the worker's startup bundling needs more room."
  type        = string
  default     = "t3.micro"
}

variable "root_volume_gb" {
  description = "Root volume. Images plus Temporal's Postgres data sit well inside this."
  type        = number
  default     = 20
}

variable "compose_version" {
  description = "Docker Compose plugin version installed by user_data."
  type        = string
  default     = "2.29.7"
}

variable "api_port" {
  description = "Host port the API binds on the instance. Its own box now, but kept off 3001 so the compose file reads the same locally and in production."
  type        = number
  default     = 4001
}

variable "temporal_ui_port" {
  description = "Host port for the Temporal Web UI."
  type        = number
  default     = 8080
}

variable "temporal_ui_cidr" {
  description = "Who may reach the Temporal UI. It is UNAUTHENTICATED and can terminate workflows, so 0.0.0.0/0 exposes an open admin panel; narrow this to your own address to close it."
  type        = string
  default     = "0.0.0.0/0"
}

variable "test_access_cidr" {
  description = "Who may reach the API and supplier ports directly, bypassing CloudFront. A single address, not the internet; update it when your address changes."
  type        = string
  default     = "223.185.130.183/32"
}
