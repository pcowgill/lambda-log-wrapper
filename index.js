'use strict';

const AWS = require('aws-sdk');

class Lambda {
    constructor(context) {
        this.context = context;
        this.lambda = new AWS.Lambda();
        this.cloudwatch = new AWS.CloudWatch();
        this.cloudwatchlogs = new AWS.CloudWatchLogs();
    }

    invoke(event) {
        return this.getDuration(event)
        .then(this.putMetricData.bind(this))
        .then(this.createLogGroup.bind(this))
        .catch((err) => {
            console.log('Lambda log Wrapper error: ',err);
        });
    }

    getDuration(event) {
        return new Promise((resolve, reject) => {
            var caller = {
                FunctionName: this.context.functionName,
                RequestId: this.context.awsRequestId
                //The ARN used to invoke this function (not sure of it's use/value)
                //,InvokedFucntionArn: this.context.invokedFunctionArn
            };

            event.Caller = caller;
            // Copy by reference then delete the FunctionName property from the event (it is repetetative)
            var eventCopy = JSON.parse(JSON.stringify(event));
            delete event.FunctionName;

            const request = {
                FunctionName: eventCopy.FunctionName,
                InvocationType: 'RequestResponse',
                Payload: JSON.stringify(event),
                LogType: 'Tail'
            };

            var startTime = Date.now();
            this.lambda.invoke(request, (err, response) => {
                var endTime = Date.now();
                var duration = endTime - startTime;

                // copy the payload into the response object
                var responseCopy = JSON.parse(JSON.stringify(response));
                var payloadCopy = JSON.parse(responseCopy.Payload);
                delete response.LogResult;
                delete response.Payload;
                response.RequestId = payloadCopy.RequestId;
                response.FunctionVersion = payloadCopy.FunctionVersion;
                response.AdditionalData = payloadCopy.AdditionalData;
                

                if (err) {
                    reject(err);
                } else {
                    // Log the result of the call
                    var log = {
                        request: event,
                        response: response,
                        processId: event.ProcessId,
                        transactionId: event.TransactionId,
                        functionName: this.context.functionName + '/' + request.FunctionName,
                        requestId: this.context.awsRequestId + '/' + response.RequestId,
                        version: this.context.functionVersion + '/' + response.FunctionVersion,
                        securityCommitHash: process.env.SECURITY_COMMIT_HASH || 'N/A',
                        applicationCommitHash: process.env.APP_COMMIT_HASH || 'N/A',
                        startTime: startTime,
                        endTime: endTime,
                        duration: duration
                    };
                    console.log(JSON.stringify(log));

                    var pmParams = {
                        MetricData: [
                            {
                                MetricName: 'Duration',
                                Timestamp: new Date(),
                                Unit: 'Milliseconds',
                                Value: duration,
                                Dimensions: [{
                                    Name: 'Correlation',
                                    Value: this.context.functionName+'/'+event.FunctionName
                                }]
                            },
                        ],
                        Namespace: 'CUSTOM/Lambda'
                    };
                    var obj = {
                        pmParams: pmParams,
                        response: response
                    };

                    resolve(obj);
                }
            });
        });
    }

    putMetricData(obj) {
        return new Promise((resolve) => {
            this.cloudwatch.putMetricData(obj.pmParams, function(err, data) {
                resolve(obj);
            });
        });
    }

    createLogGroup(obj) {
        return new Promise((resolve) => {
            var lgParams = {
                logGroupName: '/metric/lambda/correlation/'+obj.pmParams.MetricData[0].Dimensions[0].Value
            };
            this.cloudwatchlogs.createLogGroup(lgParams, function(err, data) {
                resolve(obj.response);
            });
        });
    }
}

module.exports = Lambda;
