module newproject

go 1.18

replace newproject/services/analytics-service/src/model => ./services/analytics-service/src/model
replace newproject/services/analytics-service/src/repository => ./services/analytics-service/src/repository
replace newproject/services/cdn-service/src/model => ./services/cdn-service/src/model
replace newproject/services/cdn-service/src/config => ./services/cdn-service/src/config
replace newproject/services/cdn-service/src/database => ./services/cdn-service/src/database
replace newproject/services/cdn-service/src/handler => ./services/cdn-service/src/handler
replace newproject/services/cdn-service/src/repository => ./services/cdn-service/src/repository
replace newproject/services/cdn-service/src/service => ./services/cdn-service/src/service