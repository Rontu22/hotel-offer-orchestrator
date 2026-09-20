# The instance already carries an ECR pull policy, so shipping the backend as an
# image is the path of least privilege: nothing is built on the 1 GB box.
resource "aws_ecr_repository" "backend" {
  name                 = "${var.name}-backend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 5 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }
      action       = { type = "expire" }
    }]
  })
}

/*
 * The instance role is created by this stack and already carries ECR read-only,
 * so this repository policy is belt-and-braces: it keeps pull access working even
 * if the managed policy attachment is ever narrowed.
 */
resource "aws_ecr_repository_policy" "allow_instance_pull" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowInstanceRolePull"
      Effect = "Allow"
      Principal = {
        AWS = aws_iam_role.app.arn
      }
      Action = [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability",
      ]
    }]
  })
}
