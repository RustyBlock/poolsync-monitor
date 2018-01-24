var chart = c3.generate(data),
    view = "All";

function scope(timeSpan) {

    // save current view of columns
    data.data['#' + view] = data.data.columns;

    if(data.data['#' + timeSpan]) {
        data.data.columns = data.data['#' + timeSpan];
    } else {
        for(var i=0; i< data.data.columns.length; i++) {
            var ticks = timeSpan * 60 / interval;  
            if(data.data.columns[i].length > ticks) {
                var slice = data.data.columns[i].slice(data.data.columns[i].length - ticks);
                data.data.columns[i] = [data.data.columns[i][0]].concat(slice);
            }
        }
    }
    chart.flush();    
}