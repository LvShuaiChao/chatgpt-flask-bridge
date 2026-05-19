from flask import Flask, request, jsonify
from flask_cors import CORS
import logging

app = Flask(__name__)
CORS(app)  # 允许跨域请求，默认允许所有来源

# 记录数据是否已经发送
is_client_data_sent = False
last_data = None  # 记录上一次返回的数据
new_data = None

# 关闭 Flask 内建的调试信息和日志
app.logger.setLevel(logging.ERROR)  # Set the logging level to ERROR to suppress debug messages
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024


# Disable the default access log
@app.after_request
def after_request(response):
    """Disable the access log."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.route('/process', methods=['POST'])
def process():
    global is_client_data_sent, last_data, new_data

    # 获取自定义头部 X-Request-Source，用于区分客户端请求
    request_source = request.headers.get('X-Request-Source')

    # 定义响应数据
    response = {
        "status": "",
        "processed_data": ""
    }

    # 判断请求来源
    if request_source == 'client':
        source = "Client Application"
        print(f"Request source: {source}")

        # 判断请求内容类型
        if request.is_json:
            # 处理接收到的 JSON 数据
            data_from_client = request.json.get('data', None)
            print("Received JSON data:", data_from_client)
        else:
            # 处理接收到的纯文本数据
            data_from_client = request.data.decode('utf-8')
            print("Received plain text:", data_from_client)

        # 如果没有数据，假设生成 "Hello World"
        new_data = data_from_client if data_from_client else "Hello World"
        last_data = new_data  # 更新上次返回的数据
        is_client_data_sent = True  # 每次接收到客户端数据时，设置标志为 True

        # 设置响应数据
        response["status"] = "new data"
        response["processed_data"] = '我是服务器端，谢谢客户端的来信'

        # 返回新数据
        return jsonify(response)  # 返回新数据的响应

    else:
        source = "Frontend Page"
        # print(f"Request source: {source}")

    # 如果没有新数据，返回标志
    if new_data == last_data:
        if is_client_data_sent:
            response["status"] = "new data"
            response["processed_data"] = new_data
            is_client_data_sent = False
            pass

        else:
            response["status"] = "no new data"
            response["processed_data"] = ""

        # 返回没有新数据的响应
        return jsonify(response)  # 返回无新数据的响应


if __name__ == '__main__':
    # 禁用调试模式并禁止Flask访问日志
    app.run(debug=False, use_reloader=False, host='127.0.0.1', port=5000)
