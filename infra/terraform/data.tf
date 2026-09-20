# Account-level things this stack only reads. The instance it deploys onto is no
# longer one of them: it is created here (instance.tf) and owned by this stack.

# CloudFront's origin-facing IP ranges, so the API port is not open to the world.
data "aws_ec2_managed_prefix_list" "cloudfront_origins" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# Managed policies, rather than hand-rolled ones, for CloudFront behaviour.
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}
