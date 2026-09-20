terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

# Credentials come from the environment (see infra/.env.aws), never from a file
# that could be committed.
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "hotel-offer-orchestrator"
      ManagedBy = "terraform"
    }
  }
}

# CloudFront and its certificates are global, which the API models as us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "hotel-offer-orchestrator"
      ManagedBy = "terraform"
    }
  }
}
