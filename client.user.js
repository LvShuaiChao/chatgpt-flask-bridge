// ==UserScript==
// @name         ChatGPT 客户端 - Flask 轮询联动
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  作为客户端轮询 Flask 服务端，并将返回内容自动发送到 ChatGPT
// @author       You
// @match        https://chatgpt.com/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // Flask 服务端地址
    const flaskUrl = 'http://localhost:5000/process';

    // 向 Flask 服务端发送请求并处理响应
    function sendToFlask() {
        const data = {
            title: 'Hello World'
        };

        GM_xmlhttpRequest({
            method: 'POST',
            url: flaskUrl,
            data: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json'
            },
            onload: function(response) {
                const result = JSON.parse(response.responseText);

                if (result.status === "new data") {
                    sendMessage(result.processed_data);
                    setTimeout(clickButton, 1000);
                }
            },
            onerror: function(error) {
                console.error('请求失败', error);
            }
        });
    }

    function sendMessage(flaskResponse) {
        const input = document.querySelector('#prompt-textarea');

        if (input && flaskResponse) {
            input.innerHTML = flaskResponse;

            const event = new InputEvent('input', {
                bubbles: true,
                cancelable: true
            });
            input.dispatchEvent(event);
        }

        const sendButton = document.querySelector('[data-testid="send-button"]');
        if (sendButton) {
            sendButton.click();
        } else {
            console.log('发送按钮未找到');
        }
    }

    function clickButton() {
        const xpath = "/html/body/div[1]/div/div[1]/div/main/div/div/div[2]/div[1]/div/div/div[2]/form/div[2]/div/div[3]/div/button";
        const button = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

        if (button) {
            button.click();
        } else {
            console.log("目标按钮未找到");
        }
    }

    setInterval(sendToFlask, 1000);

})();
