import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        String s = new BufferedReader(new InputStreamReader(System.in)).readLine().trim();
        char[] st = new char[s.length() + 1];
        int top = 0;
        for (char c : s.toCharArray()) {
            if (c == '(' || c == '[' || c == '{') st[top++] = c;
            else {
                if (top == 0) { System.out.println("false"); return; }
                char o = st[--top];
                if ((c == ')' && o != '(') || (c == ']' && o != '[') || (c == '}' && o != '{')) { System.out.println("false"); return; }
            }
        }
        System.out.println(top == 0 ? "true" : "false");
    }
}
