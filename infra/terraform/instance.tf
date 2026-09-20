/*
 * A dedicated instance for this stack, so nothing else on the box competes for
 * its 1 GiB. Reached only through SSM (no key pair, no open SSH port) and only
 * serving the API port to CloudFront's edge ranges.
 */

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

data "aws_vpc" "default" {
  default = true
}

# Any default subnet will do; the instance is reached through CloudFront and SSM,
# never directly, so the specific AZ does not matter.
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

# --- identity -----------------------------------------------------------------

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.name}-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

# SSM is how deploys reach the box, which is what lets it run without SSH.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Pull-only: the instance never pushes images, the deploy workstation does.
resource "aws_iam_role_policy_attachment" "ecr_pull" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.name}-instance"
  role = aws_iam_role.app.name
}

# --- network ------------------------------------------------------------------

resource "aws_security_group" "app" {
  name        = "${var.name}-app"
  description = "${var.name}: API origin from CloudFront only"
  vpc_id      = data.aws_vpc.default.id
}

# No SSH rule on purpose: SSM Session Manager covers shell access.
resource "aws_vpc_security_group_ingress_rule" "api_from_cloudfront" {
  security_group_id = aws_security_group.app.id
  description       = "API origin, CloudFront edge IPs only"

  ip_protocol    = "tcp"
  from_port      = var.api_port
  to_port        = var.api_port
  prefix_list_id = data.aws_ec2_managed_prefix_list.cloudfront_origins.id
}

/*
 * Opened by request. The Temporal UI ships no authentication, so this rule is
 * the only thing standing in front of it — narrow var.temporal_ui_cidr to close
 * it again, or drop this resource to go back to SSM-only access.
 */
resource "aws_vpc_security_group_ingress_rule" "temporal_ui" {
  security_group_id = aws_security_group.app.id
  description       = "Temporal Web UI (unauthenticated)"

  ip_protocol = "tcp"
  from_port   = var.temporal_ui_port
  to_port     = var.temporal_ui_port
  cidr_ipv4   = var.temporal_ui_cidr
}

/*
 * Direct access to the API and the supplier services for the Postman collection.
 * CloudFront rewrites X-Cache, which hides the API's own cache header, so those
 * assertions have to reach the origin directly. Scoped to one address rather
 * than the internet; set var.test_access_cidr to "" semantics by removing these
 * two rules to close it entirely.
 */
resource "aws_vpc_security_group_ingress_rule" "api_direct" {
  security_group_id = aws_security_group.app.id
  description       = "API, direct origin access for testing"

  ip_protocol = "tcp"
  from_port   = var.api_port
  to_port     = var.api_port
  cidr_ipv4   = var.test_access_cidr
}

resource "aws_vpc_security_group_ingress_rule" "suppliers_direct" {
  security_group_id = aws_security_group.app.id
  description       = "Supplier services, direct access for testing"

  ip_protocol = "tcp"
  from_port   = 4002
  to_port     = 4003
  cidr_ipv4   = var.test_access_cidr
}

# Outbound is needed to pull images from ECR and reach SSM.
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound for ECR pulls and SSM"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# --- instance -----------------------------------------------------------------

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
    encrypted   = true
  }

  # Docker and the compose plugin only; the stack itself arrives by deploy script,
  # so a redeploy never needs the instance replaced.
  user_data = <<-BASH
    #!/bin/bash
    set -eux
    dnf update -y
    dnf install -y docker
    systemctl enable --now docker

    install -d -m 0755 /usr/local/lib/docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/download/v${var.compose_version}/docker-compose-linux-x86_64" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

    install -d -m 0755 /opt/hotel-offers

    # 1 GiB with no swap leaves no room for the worker's startup bundling.
    dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  BASH

  user_data_replace_on_change = false

  tags = { Name = "${var.name}-app" }
}

# A stable address, so CloudFront's origin survives a stop/start of the instance.
resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = { Name = "${var.name}-app" }
}
