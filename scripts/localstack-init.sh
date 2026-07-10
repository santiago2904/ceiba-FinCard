#!/bin/bash
awslocal s3 mb s3://fincard-transactions
awslocal glue create-database --database-input '{"Name":"fincard_loyalty"}' || true
