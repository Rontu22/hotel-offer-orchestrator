locals {
  s3_origin  = "s3-site"
  api_origin = "ec2-api"

  # Everything the NestJS app serves. Anything else falls through to the S3 bundle.
  api_paths = ["/api/*", "/health", "/health/*"]
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.name}-site-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

/*
 * One distribution, two origins. The static bundle and the API share an origin in
 * the browser's eyes, which removes CORS entirely and means one free certificate:
 * the default *.cloudfront.net cert, so HTTPS costs nothing and needs no domain.
 */
resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "${var.name}: static site + API origin"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # cheapest edge footprint
  http_version        = "http2and3"

  origin {
    origin_id                = local.s3_origin
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id   = local.api_origin
    domain_name = aws_eip.app.public_dns

    custom_origin_config {
      # Plain HTTP to the origin: TLS is terminated at the edge, and the security
      # group only admits CloudFront's own IP ranges.
      origin_protocol_policy = "http-only"
      http_port              = var.api_port
      https_port             = 443
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  default_cache_behavior {
    target_origin_id       = local.s3_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.api_paths

    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = local.api_origin
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      # The API sets its own cache semantics and varies on the query string; the
      # Redis layer is the cache, not CloudFront.
      cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    }
  }

  # A statically exported SPA has no server to resolve unknown paths.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    # Free certificate that ships with every distribution.
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1"
  }
}
