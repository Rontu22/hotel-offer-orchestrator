output "site_url" {
  description = "HTTPS entry point for both the UI and the API."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "api_url" {
  description = "Same origin as the UI, which is why the browser needs no CORS."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}/api/hotels?city=delhi"
}

output "cloudfront_distribution_id" {
  description = "Needed to invalidate the cache after a frontend deploy."
  value       = aws_cloudfront_distribution.site.id
}

output "site_bucket" {
  description = "Destination for the static frontend build."
  value       = aws_s3_bucket.site.id
}

output "ecr_repository_url" {
  description = "Where the backend image is pushed and pulled from."
  value       = aws_ecr_repository.backend.repository_url
}

output "instance_id" {
  description = "The dedicated instance this stack creates and deploys onto."
  value       = aws_instance.app.id
}

output "api_origin" {
  description = "Direct origin address, reachable only from CloudFront's IP ranges."
  value       = "${aws_eip.app.public_dns}:${var.api_port}"
}
