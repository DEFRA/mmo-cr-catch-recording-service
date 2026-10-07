#!/bin/bash

# S3 buckets
aws s3 mb s3://mmo-cr-catch-recording-artifacts --endpoint-url http://localhost:4566

# SQS queues
#aws sqs create-queue --queue-name my-queue
