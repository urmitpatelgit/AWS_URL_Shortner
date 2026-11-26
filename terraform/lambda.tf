data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.project_name}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda_runtime" {
  statement {
    actions = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [
      "${aws_cloudwatch_log_group.shorten.arn}:*",
      "${aws_cloudwatch_log_group.resolve.arn}:*"
    ]
  }

  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.urls.arn]
  }
}

resource "aws_iam_role_policy" "lambda" {
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_runtime.json
}

resource "aws_lambda_function" "shorten" {
  function_name    = "${var.project_name}-shorten"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "src/index.shorten"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  timeout          = 8
  memory_size      = 128

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.urls.name
      BASE_URL   = "https://${var.domain_name}"
    }
  }

  depends_on = [aws_iam_role_policy.lambda, aws_cloudwatch_log_group.shorten]
}

resource "aws_lambda_function" "resolve" {
  function_name    = "${var.project_name}-resolve"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "src/index.resolve"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  timeout          = 8
  memory_size      = 128

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.urls.name
      BASE_URL   = "https://${var.domain_name}"
    }
  }

  depends_on = [aws_iam_role_policy.lambda, aws_cloudwatch_log_group.resolve]
}
